"""
Per-user quota model.

Organization quotas (``resource_quotas``) cap the whole tenant. A ``UserQuota``
caps a single member *within* that organization – e.g. "Max may use 8 vCPU,
16 GB RAM, 200 GB storage and 3 VMs, even though the organization has more".

A missing row (or ``limit_value = NULL``) means "no personal limit" – the user is
then only limited by the organization quota.
"""
from datetime import datetime
from typing import Optional

from sqlalchemy import (
    DateTime,
    Float,
    ForeignKey,
    Index,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseModel


class UserQuota(BaseModel):
    """Personal quota of a member inside an organization."""

    __tablename__ = "user_quotas"
    __table_args__ = (
        UniqueConstraint(
            "user_id", "organization_id", "resource_type",
            name="uq_user_quota_user_org_type",
        ),
        Index("ix_user_quotas_user_org", "user_id", "organization_id"),
    )

    user_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # cpu_cores, memory_gb, storage_gb, vm_count
    resource_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)

    # NULL / None = unbegrenzt (nur durch die Organisation begrenzt)
    limit_value: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # Cached usage, recalculated from the user's VMs on every read
    used_value: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)

    last_calculated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime, nullable=True
    )
