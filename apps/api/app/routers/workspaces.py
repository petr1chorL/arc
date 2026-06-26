from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.access import AuthorizationService, RequestContext, RequestContextService
from app.audit import AuditService
from app.auth import AuthenticationService, normalize_email
from app.config import Settings
from app.models import (
    InvitationRecord,
    ReviewerRecord,
    UserRecord,
    WorkspaceMembershipRecord,
    WorkspaceRecord,
    utc_now,
)
from app.schemas import (
    InvitationCreate,
    InvitationLinkRead,
    MembershipRoleUpdate,
    ReviewerQualificationRead,
    WorkspaceCreate,
    WorkspaceMemberRead,
    WorkspaceRead,
)
from app.security import SecurityService


def create_workspaces_router(
    get_session,
    context_service: RequestContextService,
    authorization_service: AuthorizationService,
    audit_service: AuditService,
) -> APIRouter:
    router = APIRouter(prefix="/api/workspaces", tags=["workspaces"])
    security = SecurityService()
    settings = Settings()
    authentication_service = AuthenticationService(security, settings)

    def build_activation_url(request: Request, token: str) -> str:
        return str(request.base_url).rstrip("/") + f"/activate/{token}"

    def organization_context(
        request: Request,
        session: Session = Depends(get_session),
    ) -> tuple[RequestContext, Session]:
        return context_service.organization_context(request, session)

    def write_organization_context(
        request: Request,
        session: Session = Depends(get_session),
    ) -> tuple[RequestContext, Session]:
        return context_service.write_organization_context(request, session)

    def workspace_context(
        workspace_id: str,
        request: Request,
        session: Session = Depends(get_session),
    ) -> tuple[RequestContext, Session]:
        return context_service.workspace_context(workspace_id, request, session)

    def write_workspace_context(
        workspace_id: str,
        request: Request,
        session: Session = Depends(get_session),
    ) -> tuple[RequestContext, Session]:
        return context_service.write_workspace_context(workspace_id, request, session)

    def record_success(
        session: Session,
        context: RequestContext,
        *,
        action: str,
        target_type: str,
        target_id: str | None,
        request: Request,
        metadata: dict | None = None,
        workspace_id: str | None = None,
    ) -> None:
        audit_service.record(
            session,
            actor=authorization_service.actor_from_context(context),
            action=action,
            target_type=target_type,
            target_id=target_id,
            outcome="success",
            request=request,
            metadata=metadata,
            workspace_id=workspace_id,
        )

    def find_membership(
        session: Session,
        workspace_id: str,
        user_id: str,
    ) -> tuple[WorkspaceMembershipRecord, UserRecord]:
        membership = session.scalar(
            select(WorkspaceMembershipRecord).where(
                WorkspaceMembershipRecord.workspace_id == workspace_id,
                WorkspaceMembershipRecord.user_id == user_id,
            ),
        )
        user = session.get(UserRecord, user_id)
        if membership is None or user is None:
            raise HTTPException(status_code=404, detail="成员不存在")
        return membership, user

    def latest_invitation_by_user(
        session: Session,
        workspace_id: str,
    ) -> dict[str, InvitationRecord]:
        records = list(
            session.scalars(
                select(InvitationRecord)
                .where(InvitationRecord.workspace_id == workspace_id)
                .order_by(InvitationRecord.created_at.desc()),
            ),
        )
        latest: dict[str, InvitationRecord] = {}
        for record in records:
            latest.setdefault(record.user_id, record)
        return latest

    def count_active_workspace_admins(
        session: Session,
        workspace_id: str,
    ) -> int:
        return session.scalar(
            select(func.count())
            .select_from(WorkspaceMembershipRecord)
            .join(UserRecord, UserRecord.id == WorkspaceMembershipRecord.user_id)
            .where(
                WorkspaceMembershipRecord.workspace_id == workspace_id,
                WorkspaceMembershipRecord.role == "workspace_admin",
                WorkspaceMembershipRecord.status == "active",
                UserRecord.status == "active",
                UserRecord.is_organization_admin.is_(False),
            ),
        ) or 0

    def serialize_member(
        user: UserRecord,
        membership: WorkspaceMembershipRecord,
        reviewer: ReviewerRecord | None,
        invitation: InvitationRecord | None,
    ) -> WorkspaceMemberRead:
        active_invitation = None
        if invitation is not None and invitation.revoked_at is None and invitation.used_at is None:
            active_invitation = invitation
        return WorkspaceMemberRead(
            user_id=user.id,
            invitation_id=active_invitation.id if active_invitation else None,
            email=user.email or "",
            display_name=user.display_name,
            role=membership.role,
            user_status=user.status,
            membership_status=membership.status,
            reviewer=ReviewerQualificationRead(
                role=reviewer.role,
                is_expert=reviewer.is_expert,
                is_active=reviewer.is_active,
            ) if reviewer else None,
            last_login_at=user.last_login_at,
        )

    def serialize_invitation_link(
        request: Request,
        invitation: InvitationRecord,
        user: UserRecord,
        raw_token: str | None,
    ) -> InvitationLinkRead:
        return InvitationLinkRead(
            invitation_id=invitation.id,
            email=user.email or "",
            role=invitation.role,
            expires_at=invitation.expires_at,
            activation_url=build_activation_url(request, raw_token) if raw_token else None,
        )

    @router.get("", response_model=list[WorkspaceRead])
    def list_workspaces(
        context_bundle: tuple[RequestContext, Session] = Depends(
            organization_context,
        ),
    ) -> list[WorkspaceRecord]:
        context, session = context_bundle
        if context.user.is_organization_admin:
            statement = (
                select(WorkspaceRecord)
                .where(
                    WorkspaceRecord.organization_id == context.organization.id,
                    WorkspaceRecord.status == "active",
                )
                .order_by(WorkspaceRecord.created_at.asc())
            )
            return list(session.scalars(statement))
        statement = (
            select(WorkspaceRecord)
            .join(
                WorkspaceMembershipRecord,
                WorkspaceMembershipRecord.workspace_id == WorkspaceRecord.id,
            )
            .where(
                WorkspaceRecord.organization_id == context.organization.id,
                WorkspaceRecord.status == "active",
                WorkspaceMembershipRecord.user_id == context.user.id,
                WorkspaceMembershipRecord.status == "active",
            )
            .order_by(WorkspaceRecord.created_at.asc())
        )
        return list(session.scalars(statement))

    @router.post(
        "",
        response_model=WorkspaceRead,
        status_code=status.HTTP_201_CREATED,
    )
    def create_workspace(
        payload: WorkspaceCreate,
        request: Request,
        context_bundle: tuple[RequestContext, Session] = Depends(
            write_organization_context,
        ),
    ) -> WorkspaceRecord:
        context, session = context_bundle
        authorization_service.require_organization_admin(
            session,
            context,
            action="workspace.create",
            target_type="workspace",
            target_id=None,
            request=request,
        )
        now = utc_now()
        workspace = WorkspaceRecord(
            organization_id=context.organization.id,
            name=payload.name.strip(),
            slug=payload.slug.strip(),
            status="active",
            created_by=context.user.id,
            created_at=now,
            updated_at=now,
        )
        session.add(workspace)
        session.flush()
        membership = WorkspaceMembershipRecord(
            workspace_id=workspace.id,
            user_id=context.user.id,
            role="workspace_admin",
            status="active",
            invited_by=context.user.id,
            activated_at=now,
            created_at=now,
            updated_at=now,
        )
        session.add(membership)
        record_success(
            session,
            context,
            action="workspace.create",
            target_type="workspace",
            target_id=workspace.id,
            request=request,
            workspace_id=workspace.id,
        )
        session.commit()
        session.refresh(workspace)
        return workspace

    @router.get("/{workspace_id}", response_model=WorkspaceRead)
    def get_workspace(
        workspace_id: str,
        context_bundle: tuple[RequestContext, Session] = Depends(
            workspace_context,
        ),
    ) -> WorkspaceRecord:
        context, _ = context_bundle
        return context.workspace

    @router.get("/{workspace_id}/members", response_model=list[WorkspaceMemberRead])
    def list_members(
        workspace_id: str,
        request: Request,
        context_bundle: tuple[RequestContext, Session] = Depends(workspace_context),
    ) -> list[WorkspaceMemberRead]:
        context, session = context_bundle
        authorization_service.require_capability(
            session,
            context,
            "member.manage",
            action="member.list",
            target_type="workspace",
            target_id=workspace_id,
            request=request,
        )
        memberships = list(
            session.scalars(
                select(WorkspaceMembershipRecord)
                .where(WorkspaceMembershipRecord.workspace_id == workspace_id)
                .order_by(WorkspaceMembershipRecord.created_at.asc()),
            ),
        )
        users = {
            user.id: user
            for user in session.scalars(
                select(UserRecord).where(
                    UserRecord.id.in_([membership.user_id for membership in memberships]),
                ),
            )
        } if memberships else {}
        reviewers = {
            reviewer.user_id: reviewer
            for reviewer in session.scalars(
                select(ReviewerRecord).where(ReviewerRecord.workspace_id == workspace_id),
            )
            if reviewer.user_id is not None
        }
        invitations = latest_invitation_by_user(session, workspace_id)
        result: list[WorkspaceMemberRead] = []
        for membership in memberships:
            user = users.get(membership.user_id)
            if user is None:
                continue
            result.append(
                serialize_member(
                    user,
                    membership,
                    reviewers.get(user.id),
                    invitations.get(user.id),
                ),
            )
        return result

    @router.post(
        "/{workspace_id}/invitations",
        response_model=InvitationLinkRead,
        status_code=status.HTTP_201_CREATED,
    )
    def create_invitation(
        workspace_id: str,
        payload: InvitationCreate,
        request: Request,
        context_bundle: tuple[RequestContext, Session] = Depends(write_workspace_context),
    ) -> InvitationLinkRead:
        context, session = context_bundle
        authorization_service.require_capability(
            session,
            context,
            "member.manage",
            action="member.invitation.create",
            target_type="workspace",
            target_id=workspace_id,
            request=request,
        )
        now = utc_now()
        normalized = normalize_email(payload.email)
        user = session.scalar(
            select(UserRecord).where(
                UserRecord.organization_id == context.organization.id,
                UserRecord.normalized_email == normalized,
            ),
        )
        if user is None:
            user = UserRecord(
                organization_id=context.organization.id,
                email=normalized,
                normalized_email=normalized,
                display_name=normalized,
                status="pending_email",
                created_at=now,
                updated_at=now,
            )
            session.add(user)
            session.flush()
        elif user.status == "disabled":
            raise HTTPException(status_code=409, detail="该用户已被停用")

        membership = session.scalar(
            select(WorkspaceMembershipRecord).where(
                WorkspaceMembershipRecord.workspace_id == workspace_id,
                WorkspaceMembershipRecord.user_id == user.id,
            ),
        )
        if membership is not None and membership.status == "active":
            raise HTTPException(status_code=409, detail="该成员已在当前 Workspace 中")

        if user.status == "active":
            if membership is None:
                membership = WorkspaceMembershipRecord(
                    workspace_id=workspace_id,
                    user_id=user.id,
                    role=payload.role,
                    status="active",
                    invited_by=context.user.id,
                    activated_at=now,
                    created_at=now,
                    updated_at=now,
                )
                session.add(membership)
            else:
                membership.role = payload.role
                membership.status = "active"
                membership.invited_by = context.user.id
                membership.activated_at = membership.activated_at or now
                membership.updated_at = now
            session.flush()
            record_success(
                session,
                context,
                action="member.add",
                target_type="membership",
                target_id=membership.id,
                request=request,
                metadata={"userId": user.id, "role": payload.role},
                workspace_id=workspace_id,
            )
            session.commit()
            return InvitationLinkRead(
                invitation_id="",
                email=user.email or normalized,
                role=membership.role,
                expires_at=now,
                activation_url=None,
            )

        if membership is None:
            membership = WorkspaceMembershipRecord(
                workspace_id=workspace_id,
                user_id=user.id,
                role=payload.role,
                status="invited",
                invited_by=context.user.id,
                created_at=now,
                updated_at=now,
            )
            session.add(membership)
        else:
            membership.role = payload.role
            membership.status = "invited"
            membership.invited_by = context.user.id
            membership.activated_at = None
            membership.updated_at = now

        raw_token = security.new_token()
        invitation = session.scalar(
            select(InvitationRecord).where(
                InvitationRecord.workspace_id == workspace_id,
                InvitationRecord.user_id == user.id,
            ),
        )
        if invitation is None:
            invitation = InvitationRecord(
                organization_id=context.organization.id,
                workspace_id=workspace_id,
                user_id=user.id,
                role=payload.role,
                token_digest=security.digest_token(raw_token),
                expires_at=now + timedelta(hours=settings.invitation_hours),
                created_by=context.user.id,
                created_at=now,
            )
            session.add(invitation)
        else:
            invitation.role = payload.role
            invitation.token_digest = security.digest_token(raw_token)
            invitation.expires_at = now + timedelta(hours=settings.invitation_hours)
            invitation.used_at = None
            invitation.revoked_at = None
            invitation.created_by = context.user.id
            invitation.created_at = now
        session.flush()
        record_success(
            session,
            context,
            action="member.invitation.create",
            target_type="invitation",
            target_id=invitation.id,
            request=request,
            metadata={"userId": user.id, "role": payload.role},
            workspace_id=workspace_id,
        )
        session.commit()
        session.refresh(invitation)
        return serialize_invitation_link(request, invitation, user, raw_token)

    @router.post(
        "/{workspace_id}/invitations/{invitation_id}/copy",
        status_code=204,
    )
    def record_invitation_link_copy(
        workspace_id: str,
        invitation_id: str,
        request: Request,
        context_bundle: tuple[RequestContext, Session] = Depends(write_workspace_context),
    ) -> None:
        context, session = context_bundle
        authorization_service.require_capability(
            session,
            context,
            "member.manage",
            action="member.invitation.copy_link",
            target_type="invitation",
            target_id=invitation_id,
            request=request,
        )
        invitation = session.scalar(
            select(InvitationRecord).where(
                InvitationRecord.id == invitation_id,
                InvitationRecord.workspace_id == workspace_id,
            ),
        )
        if invitation is None:
            raise HTTPException(status_code=404, detail="邀请不存在")
        if invitation.revoked_at is not None or invitation.used_at is not None:
            raise HTTPException(status_code=409, detail="邀请不可复制")
        record_success(
            session,
            context,
            action="member.invitation.copy_link",
            target_type="invitation",
            target_id=invitation.id,
            request=request,
            metadata={"userId": invitation.user_id},
            workspace_id=workspace_id,
        )
        session.commit()

    @router.post(
        "/{workspace_id}/invitations/{invitation_id}/resend",
        response_model=InvitationLinkRead,
    )
    def resend_invitation(
        workspace_id: str,
        invitation_id: str,
        request: Request,
        context_bundle: tuple[RequestContext, Session] = Depends(write_workspace_context),
    ) -> InvitationLinkRead:
        context, session = context_bundle
        authorization_service.require_capability(
            session,
            context,
            "member.manage",
            action="member.invitation.resend",
            target_type="invitation",
            target_id=invitation_id,
            request=request,
        )
        invitation = session.scalar(
            select(InvitationRecord).where(
                InvitationRecord.id == invitation_id,
                InvitationRecord.workspace_id == workspace_id,
            ),
        )
        if invitation is None:
            raise HTTPException(status_code=404, detail="邀请不存在")
        if invitation.used_at is not None:
            raise HTTPException(status_code=409, detail="邀请已使用")

        user = session.get(UserRecord, invitation.user_id)
        if user is None:
            raise HTTPException(status_code=409, detail="邀请已失效")
        if user.status == "disabled":
            raise HTTPException(status_code=409, detail="该用户已被停用")

        raw_token = security.new_token()
        now = utc_now()
        invitation.token_digest = security.digest_token(raw_token)
        invitation.expires_at = now + timedelta(hours=settings.invitation_hours)
        invitation.revoked_at = None
        invitation.created_by = context.user.id
        invitation.created_at = now
        record_success(
            session,
            context,
            action="member.invitation.resend",
            target_type="invitation",
            target_id=invitation.id,
            request=request,
            metadata={"userId": user.id},
            workspace_id=workspace_id,
        )
        session.commit()
        return InvitationLinkRead(
            invitation_id=invitation.id,
            email=user.email or "",
            role=invitation.role,
            expires_at=invitation.expires_at,
            activation_url=build_activation_url(request, raw_token),
        )

    @router.post(
        "/{workspace_id}/invitations/{invitation_id}/revoke",
        status_code=204,
    )
    def revoke_invitation(
        workspace_id: str,
        invitation_id: str,
        request: Request,
        context_bundle: tuple[RequestContext, Session] = Depends(write_workspace_context),
    ) -> None:
        context, session = context_bundle
        authorization_service.require_capability(
            session,
            context,
            "member.manage",
            action="member.invitation.revoke",
            target_type="invitation",
            target_id=invitation_id,
            request=request,
        )
        invitation = session.scalar(
            select(InvitationRecord).where(
                InvitationRecord.id == invitation_id,
                InvitationRecord.workspace_id == workspace_id,
            ),
        )
        if invitation is None:
            raise HTTPException(status_code=404, detail="邀请不存在")
        if invitation.used_at is not None:
            raise HTTPException(status_code=409, detail="邀请已使用")
        invitation.revoked_at = utc_now()
        record_success(
            session,
            context,
            action="member.invitation.revoke",
            target_type="invitation",
            target_id=invitation.id,
            request=request,
            metadata={"userId": invitation.user_id},
            workspace_id=workspace_id,
        )
        session.commit()

    @router.patch(
        "/{workspace_id}/members/{user_id}",
        response_model=WorkspaceMemberRead,
    )
    def update_member_role(
        workspace_id: str,
        user_id: str,
        payload: MembershipRoleUpdate,
        request: Request,
        context_bundle: tuple[RequestContext, Session] = Depends(write_workspace_context),
    ) -> WorkspaceMemberRead:
        context, session = context_bundle
        authorization_service.require_capability(
            session,
            context,
            "member.manage",
            action="member.role.update",
            target_type="membership",
            target_id=user_id,
            request=request,
        )
        membership, user = find_membership(session, workspace_id, user_id)
        if (
            membership.role == "workspace_admin"
            and payload.role != "workspace_admin"
            and membership.status == "active"
            and count_active_workspace_admins(session, workspace_id) <= 1
        ):
            raise HTTPException(status_code=409, detail="必须至少保留一名有效 Workspace 管理员")
        membership.role = payload.role
        membership.updated_at = utc_now()
        reviewer = session.scalar(
            select(ReviewerRecord).where(
                ReviewerRecord.workspace_id == workspace_id,
                ReviewerRecord.user_id == user_id,
            ),
        )
        invitation = latest_invitation_by_user(session, workspace_id).get(user_id)
        record_success(
            session,
            context,
            action="member.role.update",
            target_type="membership",
            target_id=membership.id,
            request=request,
            metadata={"userId": user_id, "role": payload.role},
            workspace_id=workspace_id,
        )
        session.commit()
        return serialize_member(user, membership, reviewer, invitation)

    @router.post(
        "/{workspace_id}/members/{user_id}/disable",
        response_model=WorkspaceMemberRead,
    )
    def disable_member(
        workspace_id: str,
        user_id: str,
        request: Request,
        context_bundle: tuple[RequestContext, Session] = Depends(write_workspace_context),
    ) -> WorkspaceMemberRead:
        context, session = context_bundle
        authorization_service.require_capability(
            session,
            context,
            "member.manage",
            action="member.disable",
            target_type="membership",
            target_id=user_id,
            request=request,
        )
        if context.user.id == user_id:
            raise HTTPException(status_code=409, detail="不能停用自己的成员关系")
        membership, user = find_membership(session, workspace_id, user_id)
        if (
            membership.role == "workspace_admin"
            and membership.status == "active"
            and count_active_workspace_admins(session, workspace_id) <= 1
        ):
            raise HTTPException(status_code=409, detail="必须至少保留一名有效 Workspace 管理员")
        membership.status = "disabled"
        membership.updated_at = utc_now()
        reviewer = session.scalar(
            select(ReviewerRecord).where(
                ReviewerRecord.workspace_id == workspace_id,
                ReviewerRecord.user_id == user_id,
            ),
        )
        invitation = latest_invitation_by_user(session, workspace_id).get(user_id)
        record_success(
            session,
            context,
            action="member.disable",
            target_type="membership",
            target_id=membership.id,
            request=request,
            metadata={"userId": user_id},
            workspace_id=workspace_id,
        )
        session.commit()
        return serialize_member(user, membership, reviewer, invitation)

    @router.post(
        "/{workspace_id}/members/{user_id}/enable",
        response_model=WorkspaceMemberRead,
    )
    def enable_member(
        workspace_id: str,
        user_id: str,
        request: Request,
        context_bundle: tuple[RequestContext, Session] = Depends(write_workspace_context),
    ) -> WorkspaceMemberRead:
        context, session = context_bundle
        authorization_service.require_capability(
            session,
            context,
            "member.manage",
            action="member.enable",
            target_type="membership",
            target_id=user_id,
            request=request,
        )
        membership, user = find_membership(session, workspace_id, user_id)
        if user.status != "active":
            raise HTTPException(status_code=409, detail="用户尚未激活")
        membership.status = "active"
        membership.updated_at = utc_now()
        reviewer = session.scalar(
            select(ReviewerRecord).where(
                ReviewerRecord.workspace_id == workspace_id,
                ReviewerRecord.user_id == user_id,
            ),
        )
        invitation = latest_invitation_by_user(session, workspace_id).get(user_id)
        record_success(
            session,
            context,
            action="member.enable",
            target_type="membership",
            target_id=membership.id,
            request=request,
            metadata={"userId": user_id},
            workspace_id=workspace_id,
        )
        session.commit()
        return serialize_member(user, membership, reviewer, invitation)

    @router.post(
        "/{workspace_id}/members/{user_id}/user/disable",
        response_model=WorkspaceMemberRead,
    )
    def disable_user(
        workspace_id: str,
        user_id: str,
        request: Request,
        context_bundle: tuple[RequestContext, Session] = Depends(write_workspace_context),
    ) -> WorkspaceMemberRead:
        context, session = context_bundle
        authorization_service.require_organization_admin(
            session,
            context,
            action="user.disable",
            target_type="user",
            target_id=user_id,
            request=request,
            metadata={"workspaceId": workspace_id},
        )
        if context.user.id == user_id:
            raise HTTPException(status_code=409, detail="不能停用自己的 User")
        membership, user = find_membership(session, workspace_id, user_id)
        if (
            membership.role == "workspace_admin"
            and membership.status == "active"
            and count_active_workspace_admins(session, workspace_id) <= 1
        ):
            raise HTTPException(status_code=409, detail="必须至少保留一名有效 Workspace 管理员")
        user.status = "disabled"
        user.updated_at = utc_now()
        authentication_service.revoke_user_sessions(session, user.id, "user_disabled")
        reviewer = session.scalar(
            select(ReviewerRecord).where(
                ReviewerRecord.workspace_id == workspace_id,
                ReviewerRecord.user_id == user_id,
            ),
        )
        invitation = latest_invitation_by_user(session, workspace_id).get(user_id)
        record_success(
            session,
            context,
            action="user.disable",
            target_type="user",
            target_id=user.id,
            request=request,
            metadata={"workspaceId": workspace_id},
            workspace_id=workspace_id,
        )
        session.commit()
        return serialize_member(user, membership, reviewer, invitation)

    @router.post(
        "/{workspace_id}/members/{user_id}/user/enable",
        response_model=WorkspaceMemberRead,
    )
    def enable_user(
        workspace_id: str,
        user_id: str,
        request: Request,
        context_bundle: tuple[RequestContext, Session] = Depends(write_workspace_context),
    ) -> WorkspaceMemberRead:
        context, session = context_bundle
        authorization_service.require_organization_admin(
            session,
            context,
            action="user.enable",
            target_type="user",
            target_id=user_id,
            request=request,
            metadata={"workspaceId": workspace_id},
        )
        membership, user = find_membership(session, workspace_id, user_id)
        if user.status == "disabled":
            user.status = "active"
            user.failed_login_count = 0
            user.locked_until = None
            user.updated_at = utc_now()
        reviewer = session.scalar(
            select(ReviewerRecord).where(
                ReviewerRecord.workspace_id == workspace_id,
                ReviewerRecord.user_id == user_id,
            ),
        )
        invitation = latest_invitation_by_user(session, workspace_id).get(user_id)
        record_success(
            session,
            context,
            action="user.enable",
            target_type="user",
            target_id=user.id,
            request=request,
            metadata={"workspaceId": workspace_id},
            workspace_id=workspace_id,
        )
        session.commit()
        return serialize_member(user, membership, reviewer, invitation)

    return router
