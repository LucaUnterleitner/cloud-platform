"""
Per-user quota service.

Usage is *derived* from the user's own VMs (no incremental counters), so it can
never drift. The effective limit of a user is
``min(organization limit, personal limit)`` – a personal quota can only narrow
what the organization allows, never widen it.
"""
import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user_quota import UserQuota
from app.models.virtual_machine import VirtualMachine
from app.models.vm_disk import VMDisk

logger = logging.getLogger(__name__)


class UserQuotaService:
    """Read and write personal quotas ("was darf dieser Benutzer verbrauchen")."""

    # Only these resources make sense per user
    RESOURCE_TYPES = {
        "cpu_cores": "CPU Cores",
        "memory_gb": "Memory (GB)",
        "storage_gb": "Storage (GB)",
        "vm_count": "VMs",
    }

    def __init__(self, db: AsyncSession):
        self.db = db

    # ------------------------------------------------------------------ usage
    async def calculate_usage(self, organization_id: str, user_id: str) -> Dict[str, float]:
        """Sum up the resources the user currently occupies with own VMs."""
        vm_result = await self.db.execute(
            select(
                func.count(VirtualMachine.id).label("vm_count"),
                func.sum(VirtualMachine.cpu_cores).label("total_cpu"),
                func.sum(VirtualMachine.memory_mb).label("total_memory"),
            ).where(
                VirtualMachine.organization_id == organization_id,
                VirtualMachine.owner_id == user_id,
                VirtualMachine.deleted_at.is_(None),
                VirtualMachine.status != "error",
            )
        )
        vm_stats = vm_result.one()

        storage_result = await self.db.execute(
            select(func.sum(VMDisk.size_gb)).join(
                VirtualMachine, VMDisk.vm_id == VirtualMachine.id
            ).where(
                VirtualMachine.organization_id == organization_id,
                VirtualMachine.owner_id == user_id,
                VirtualMachine.deleted_at.is_(None),
                VMDisk.deleted_at.is_(None),
                VMDisk.is_cdrom == False,  # noqa: E712
                VirtualMachine.status != "error",
            )
        )

        return {
            "cpu_cores": float(vm_stats.total_cpu or 0),
            "memory_gb": float(vm_stats.total_memory or 0) / 1024,
            "storage_gb": float(storage_result.scalar_one() or 0),
            "vm_count": float(vm_stats.vm_count or 0),
        }

    # ----------------------------------------------------------------- quotas
    async def _get_rows(self, organization_id: str, user_id: str) -> Dict[str, UserQuota]:
        result = await self.db.execute(
            select(UserQuota).where(
                UserQuota.organization_id == organization_id,
                UserQuota.user_id == user_id,
            )
        )
        return {row.resource_type: row for row in result.scalars().all()}

    async def get_user_quota(self, organization_id: str, user_id: str) -> Dict[str, Any]:
        """Limits + usage of a single user (missing limit = unlimited)."""
        rows = await self._get_rows(organization_id, user_id)
        usage = await self.calculate_usage(organization_id, user_id)

        resources: List[Dict[str, Any]] = []
        for resource_type, label in self.RESOURCE_TYPES.items():
            row = rows.get(resource_type)
            limit = row.limit_value if row else None
            used = usage.get(resource_type, 0.0)
            resources.append(
                {
                    "resource_type": resource_type,
                    "resource_name": label,
                    "limit": limit,
                    "used": used,
                    "remaining": None if limit is None else max(0.0, limit - used),
                }
            )

        return {"user_id": user_id, "organization_id": organization_id, "resources": resources}

    async def set_limit(
        self,
        organization_id: str,
        user_id: str,
        resource_type: str,
        limit_value: Optional[float],
    ) -> Optional[UserQuota]:
        """Set (or clear, with ``None``) a personal limit."""
        if resource_type not in self.RESOURCE_TYPES:
            raise ValueError(f"Unknown resource type: {resource_type}")
        if limit_value is not None and limit_value < 0:
            raise ValueError("Limit must not be negative")

        rows = await self._get_rows(organization_id, user_id)
        row = rows.get(resource_type)

        if row is None:
            row = UserQuota(
                user_id=user_id,
                organization_id=organization_id,
                resource_type=resource_type,
                limit_value=limit_value,
            )
            self.db.add(row)
        else:
            row.limit_value = limit_value

        row.last_calculated_at = datetime.utcnow()
        await self.db.commit()
        await self.db.refresh(row)
        return row

    async def check_user_quota(
        self,
        organization_id: str,
        user_id: str,
        requested: Dict[str, float],
    ) -> List[str]:
        """
        Check a planned allocation against the user's personal limits.

        Args:
            requested: e.g. ``{"cpu_cores": 4, "memory_gb": 8, "storage_gb": 80, "vm_count": 1}``

        Returns:
            List of human readable violations (empty = ok).
        """
        rows = await self._get_rows(organization_id, user_id)
        usage = await self.calculate_usage(organization_id, user_id)

        violations: List[str] = []
        for resource_type, amount in requested.items():
            row = rows.get(resource_type)
            if row is None or row.limit_value is None:
                continue

            used = usage.get(resource_type, 0.0)
            if used + amount > row.limit_value:
                label = self.RESOURCE_TYPES.get(resource_type, resource_type)
                violations.append(
                    f"{label}: {used + amount:g} benötigt, persönliches Limit {row.limit_value:g} "
                    f"(bereits belegt: {used:g})"
                )

        return violations

    async def get_member_quotas(self, organization_id: str, user_ids: List[str]) -> Dict[str, Dict[str, Any]]:
        """Quota summary for several members at once (member list in the GUI)."""
        result: Dict[str, Dict[str, Any]] = {}
        for user_id in user_ids:
            result[user_id] = await self.get_user_quota(organization_id, user_id)
        return result

    async def delete_user_quotas(self, organization_id: str, user_id: str) -> int:
        """Remove all personal limits of a user (e.g. when membership ends)."""
        rows = await self._get_rows(organization_id, user_id)
        for row in rows.values():
            await self.db.delete(row)
        await self.db.commit()
        return len(rows)
