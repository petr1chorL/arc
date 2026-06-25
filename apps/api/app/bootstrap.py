import os
from collections.abc import Callable
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import normalize_email
from app.config import Settings
from app.database import create_database
from app.migrations import ensure_current_schema
from app.models import (
    Base,
    OrganizationRecord,
    UserRecord,
    WorkspaceMembershipRecord,
    WorkspaceRecord,
    utc_now,
)
from app.security import SecurityService


DEFAULT_ORGANIZATION_NAME = "安克创新"
DEFAULT_ORGANIZATION_SLUG = "anker-innovation"
DEFAULT_WORKSPACE_NAME = "AI 能力中心"
DEFAULT_WORKSPACE_SLUG = "ai-capability-center"


def bootstrap_default_workspace(
    session: Session,
    *,
    organization_name: str = DEFAULT_ORGANIZATION_NAME,
    organization_slug: str = DEFAULT_ORGANIZATION_SLUG,
) -> tuple[OrganizationRecord, WorkspaceRecord]:
    now = utc_now()
    organization = session.scalar(
        select(OrganizationRecord).where(
            OrganizationRecord.slug == organization_slug,
        ),
    )
    if organization is None:
        organization = OrganizationRecord(
            name=organization_name,
            slug=organization_slug,
            status="active",
            created_at=now,
            updated_at=now,
        )
        session.add(organization)
        session.flush()

    workspace = session.scalar(
        select(WorkspaceRecord).where(
            WorkspaceRecord.organization_id == organization.id,
            WorkspaceRecord.slug == DEFAULT_WORKSPACE_SLUG,
        ),
    )
    if workspace is None:
        workspace = WorkspaceRecord(
            organization_id=organization.id,
            name=DEFAULT_WORKSPACE_NAME,
            slug=DEFAULT_WORKSPACE_SLUG,
            status="active",
            created_at=now,
            updated_at=now,
        )
        session.add(workspace)
        session.flush()
    return organization, workspace


def bootstrap_organization_admin(
    session: Session,
    security: SecurityService,
    *,
    organization_name: str,
    organization_slug: str,
    email: str,
    display_name: str,
    password: str,
    clock: Callable[[], datetime] = utc_now,
) -> UserRecord:
    organization, workspace = bootstrap_default_workspace(
        session,
        organization_name=organization_name,
        organization_slug=organization_slug,
    )
    normalized_email = normalize_email(email)
    user = session.scalar(
        select(UserRecord).where(
            UserRecord.organization_id == organization.id,
            UserRecord.normalized_email == normalized_email,
        ),
    )
    now = clock()
    if user is None:
        user = UserRecord(
            organization_id=organization.id,
            email=email.strip(),
            normalized_email=normalized_email,
            display_name=display_name.strip(),
            password_hash=security.hash_password(password),
            status="active",
            is_organization_admin=True,
            password_changed_at=now,
            last_workspace_id=workspace.id,
            created_at=now,
            updated_at=now,
        )
        session.add(user)
        session.flush()
    elif (
        user.status != "active"
        or not user.is_organization_admin
        or user.password_hash is None
    ):
        user.email = email.strip()
        user.normalized_email = normalized_email
        user.display_name = display_name.strip()
        user.password_hash = security.hash_password(password)
        user.status = "active"
        user.is_organization_admin = True
        user.password_changed_at = now
        user.last_workspace_id = workspace.id
        user.updated_at = now

    membership = session.scalar(
        select(WorkspaceMembershipRecord).where(
            WorkspaceMembershipRecord.workspace_id == workspace.id,
            WorkspaceMembershipRecord.user_id == user.id,
        ),
    )
    if membership is None:
        membership = WorkspaceMembershipRecord(
            workspace_id=workspace.id,
            user_id=user.id,
            role="workspace_admin",
            status="active",
            invited_by=user.id,
            activated_at=now,
            created_at=now,
            updated_at=now,
        )
        session.add(membership)
    else:
        membership.role = "workspace_admin"
        membership.status = "active"
        membership.invited_by = user.id
        membership.activated_at = membership.activated_at or now
        membership.updated_at = now
    if workspace.created_by is None:
        workspace.created_by = user.id
        workspace.updated_at = now
    session.commit()
    session.refresh(user)
    return user


def _required_environment(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise SystemExit(f"缺少必填环境变量 {name}")
    return value


def main() -> None:
    email = _required_environment("ARC_ONE_ADMIN_EMAIL")
    password = _required_environment("ARC_ONE_ADMIN_PASSWORD")
    display_name = os.environ.get(
        "ARC_ONE_ADMIN_DISPLAY_NAME",
        "平台管理员",
    )
    organization_name = os.environ.get(
        "ARC_ONE_ORGANIZATION_NAME",
        DEFAULT_ORGANIZATION_NAME,
    )
    settings = Settings()
    engine, session_factory = create_database(settings.database_url)
    Base.metadata.create_all(engine)
    ensure_current_schema(engine)
    with session_factory() as session:
        user = bootstrap_organization_admin(
            session,
            SecurityService(),
            organization_name=organization_name,
            organization_slug=DEFAULT_ORGANIZATION_SLUG,
            email=email,
            display_name=display_name,
            password=password,
        )
    print(f"组织管理员已就绪：{user.email}")
