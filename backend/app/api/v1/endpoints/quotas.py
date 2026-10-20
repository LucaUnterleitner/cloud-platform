"""
Quota management endpoints.
"""
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models.user import User
from app.core.deps import (
    get_current_user,
    get_organization_context,
    get_current_superadmin,
    OrgContext,
    RequirePermission
)
from app.core.rbac import Permission
from app.services.quota_service import QuotaService
from app.services.user_quota_service import UserQuotaService
from app.models.organization_member import OrganizationMember
from app.schemas.quota import (
    QuotaResponse,
    QuotaUsageResponse,
    QuotaResourceUsage,
    QuotaUpdateRequest,
    UserQuotaResponse,
    UserQuotaUpdateRequest,
)

router = APIRouter(prefix="/quotas", tags=["Quotas"])


@router.get("", response_model=List[QuotaResponse])
async def get_organization_quotas(
    org_context: OrgContext = Depends(RequirePermission(Permission.QUOTA_READ)),
    db: AsyncSession = Depends(get_db)
) -> List[dict]:
    """
    Get all quotas for organization.

    Ensures all resource types exist and returns complete quota information.

    Requires: QUOTA_READ permission
    """
    quota_service = QuotaService(db)
    quotas = await quota_service.get_all_quotas(org_context.org_id)

    return quotas


@router.get("/usage", response_model=QuotaUsageResponse)
async def get_quota_usage(
    org_context: OrgContext = Depends(RequirePermission(Permission.QUOTA_READ)),
    db: AsyncSession = Depends(get_db)
) -> dict:
    """
    Get detailed quota usage information.

    Returns usage details for all resource types with percentages and remaining amounts.

    Requires: QUOTA_READ permission
    """
    quota_service = QuotaService(db)
    quotas = await quota_service.get_all_quotas(org_context.org_id)

    usage_data = {
        "organization_id": org_context.org_id,
        "resources": []
    }

    for quota in quotas:
        usage_data["resources"].append(
            QuotaResourceUsage(
                resource_type=quota.resource_type,
                resource_name=QuotaService.RESOURCE_TYPES[quota.resource_type],
                used=quota.used_value,
                limit=quota.limit_value,
                remaining=quota.remaining,
                usage_percentage=quota.usage_percentage,
                last_calculated=quota.last_calculated_at
            )
        )

    return usage_data


@router.get("/members", response_model=List[dict])
async def get_member_quotas(
    org_context: OrgContext = Depends(RequirePermission(Permission.QUOTA_READ)),
    db: AsyncSession = Depends(get_db)
) -> List[dict]:
    """
    Personal quotas + current usage of all members of the organization.

    Members without personal limits are only bound by the organization quota.

    Requires: QUOTA_READ permission
    """
    members_result = await db.execute(
        select(OrganizationMember).where(
            OrganizationMember.organization_id == org_context.org_id,
            OrganizationMember.deleted_at.is_(None)
        )
    )
    members = members_result.scalars().all()

    service = UserQuotaService(db)
    result: List[dict] = []
    for member in members:
        quota = await service.get_user_quota(org_context.org_id, member.user_id)
        result.append({**quota, "role": member.role})
    return result


@router.get("/users/{user_id}", response_model=UserQuotaResponse)
async def get_user_quota(
    user_id: str,
    org_context: OrgContext = Depends(RequirePermission(Permission.QUOTA_READ)),
    db: AsyncSession = Depends(get_db)
) -> dict:
    """
    Personal quota of a single member (limit, usage, remaining).

    Requires: QUOTA_READ permission
    """
    result = await db.execute(
        select(OrganizationMember).where(
            OrganizationMember.user_id == user_id,
            OrganizationMember.organization_id == org_context.org_id,
            OrganizationMember.deleted_at.is_(None)
        )
    )
    if result.scalar_one_or_none() is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Benutzer ist kein Mitglied dieser Organisation."
        )

    service = UserQuotaService(db)
    return await service.get_user_quota(org_context.org_id, user_id)


@router.put("/users/{user_id}/{resource_type}", response_model=dict)
async def set_user_quota(
    user_id: str,
    resource_type: str,
    payload: UserQuotaUpdateRequest,
    org_context: OrgContext = Depends(RequirePermission(Permission.QUOTA_UPDATE)),
    db: AsyncSession = Depends(get_db)
) -> dict:
    """
    Set or clear the personal limit of a member.

    ``limit_value = null`` removes the personal limit (user is then only bound by
    the organization quota). A personal limit can only narrow, never widen.

    Requires: QUOTA_UPDATE permission
    """
    result = await db.execute(
        select(OrganizationMember).where(
            OrganizationMember.user_id == user_id,
            OrganizationMember.organization_id == org_context.org_id,
            OrganizationMember.deleted_at.is_(None)
        )
    )
    if result.scalar_one_or_none() is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Benutzer ist kein Mitglied dieser Organisation."
        )

    service = UserQuotaService(db)
    try:
        await service.set_limit(
            org_context.org_id, user_id, resource_type, payload.limit_value
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    return await service.get_user_quota(org_context.org_id, user_id)


@router.put("/{resource_type}", response_model=QuotaResponse)
async def update_quota_limit(
    resource_type: str,
    quota_update: QuotaUpdateRequest,
    org_context: OrgContext = Depends(get_organization_context),
    current_user: User = Depends(get_current_superadmin),  # Only superadmins
    db: AsyncSession = Depends(get_db)
) -> dict:
    """
    Update quota limit (superadmin only).

    Only superadmins can update quota limits for organizations.

    Args:
        resource_type: Type of resource (cpu_cores, memory_gb, etc.)
        quota_update: New limit value

    Returns:
        Updated quota information

    Requires: Superadmin role
    """
    if resource_type not in QuotaService.RESOURCE_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid resource type: {resource_type}. "
                   f"Valid types: {', '.join(QuotaService.RESOURCE_TYPES.keys())}"
        )

    quota_service = QuotaService(db)
    quota = await quota_service.update_quota_limit(
        organization_id=org_context.org_id,
        resource_type=resource_type,
        new_limit=quota_update.limit_value
    )

    return quota


@router.post("/recalculate", status_code=status.HTTP_202_ACCEPTED)
async def recalculate_quotas(
    org_context: OrgContext = Depends(get_organization_context),
    current_user: User = Depends(get_current_superadmin),
    db: AsyncSession = Depends(get_db)
) -> dict:
    """
    Recalculate quota usage from actual resources (superadmin only).

    This endpoint recalculates the actual resource usage by querying the database
    and updates the quota usage values. Useful for fixing drift between quota
    tracking and actual resource usage.

    Requires: Superadmin role
    """
    quota_service = QuotaService(db)
    await quota_service.recalculate_usage(org_context.org_id)

    return {
        "message": "Quota usage recalculated successfully",
        "organization_id": org_context.org_id
    }
