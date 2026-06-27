from dataclasses import dataclass, replace

from fastapi import HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.audit import AuditActor, AuditService
from app.auth import AuthenticationError, AuthenticationService, CsrfError
from app.config import Settings
from app.models import (
    OrganizationRecord,
    SessionRecord,
    UserRecord,
    WorkspaceMembershipRecord,
    WorkspaceRecord,
)
from app.routers.auth import SessionAuthenticationError


ROLE_LEVEL = {
    "viewer": 10,
    "operator": 20,
    "builder": 30,
    "workspace_admin": 40,
}

CAPABILITY_MIN_ROLE = {
    "asset.read": "viewer",
    "run.read": "viewer",
    "run.execute": "operator",
    "evaluation.run": "operator",
    "agent.write": "builder",
    "agent.publish": "builder",
    "rubric.write": "builder",
    "rubric.publish": "builder",
    "workflow.write": "builder",
    "workflow.publish": "builder",
    "asset.deactivate": "workspace_admin",
    "member.manage": "workspace_admin",
    "reviewer.manage": "workspace_admin",
    "workspace.manage": "workspace_admin",
    "audit.read": "workspace_admin",
    "audit.export": "workspace_admin",
}

CAPABILITY_LABELS = {
    "asset.read": "读取资产",
    "run.read": "读取运行",
    "run.execute": "执行运行",
    "evaluation.run": "执行评估",
    "agent.write": "编辑 Agent",
    "agent.publish": "发布 Agent",
    "rubric.write": "编辑 Rubric",
    "rubric.publish": "发布 Rubric",
    "workflow.write": "编辑工作流",
    "workflow.publish": "发布工作流",
    "asset.deactivate": "停用资产",
    "member.manage": "管理成员",
    "reviewer.manage": "管理 Reviewer 资格",
    "workspace.manage": "管理 Workspace",
    "audit.read": "读取审计",
    "audit.export": "导出审计",
}


def build_permission_matrix() -> dict:
    roles = [
        role
        for role, _level in sorted(ROLE_LEVEL.items(), key=lambda item: item[1])
    ]
    capabilities = [
        {
            "key": capability,
            "label": CAPABILITY_LABELS.get(capability, capability),
            "requiredRole": required_role,
        }
        for capability, required_role in sorted(
            CAPABILITY_MIN_ROLE.items(),
            key=lambda item: (ROLE_LEVEL[item[1]], item[0]),
        )
    ]
    matrix = []
    for role in roles:
        matrix.append({
            "role": role,
            "capabilities": {
                capability["key"]: ROLE_LEVEL[role] >= ROLE_LEVEL[capability["requiredRole"]]
                for capability in capabilities
            },
        })
    return {
        "roles": roles,
        "capabilities": capabilities,
        "matrix": matrix,
        "reviewerQualificationNote": (
            "Reviewer 是人工任务处理的业务资格，不等于平台角色；"
            "成员需要同时具备有效 Membership 和 Reviewer 资格才能处理对应人工任务。"
        ),
    }


@dataclass(frozen=True)
class RequestContext:
    user: UserRecord
    organization: OrganizationRecord
    workspace: WorkspaceRecord | None
    membership: WorkspaceMembershipRecord | None
    session: SessionRecord


class AuthorizationService:
    def __init__(self, audit_service: AuditService):
        self.audit_service = audit_service

    @staticmethod
    def actor_from_context(context: RequestContext) -> AuditActor:
        return AuditActor(
            organization_id=context.organization.id,
            workspace_id=context.workspace.id if context.workspace else None,
            actor_user_id=context.user.id,
            session_id=context.session.id,
        )

    def require_capability(
        self,
        session: Session,
        context: RequestContext,
        capability: str,
        *,
        action: str,
        target_type: str,
        target_id: str | None,
        request: Request | None = None,
        metadata: dict | None = None,
        workspace_id: str | None = None,
    ) -> None:
        if context.user.is_organization_admin:
            return
        membership = context.membership
        required_role = CAPABILITY_MIN_ROLE[capability]
        actual_role = membership.role if membership is not None else None
        if actual_role is None or ROLE_LEVEL.get(actual_role, 0) < ROLE_LEVEL[required_role]:
            self.audit_service.record(
                session,
                actor=self.actor_from_context(context),
                action=action,
                target_type=target_type,
                target_id=target_id,
                outcome="denied",
                request=request,
                metadata={"capability": capability, **(metadata or {})},
                workspace_id=workspace_id,
            )
            session.commit()
            raise HTTPException(status_code=403, detail="权限不足")

    def require_organization_admin(
        self,
        session: Session,
        context: RequestContext,
        *,
        action: str,
        target_type: str,
        target_id: str | None,
        request: Request | None = None,
        metadata: dict | None = None,
    ) -> None:
        if context.user.is_organization_admin:
            return
        self.audit_service.record(
            session,
            actor=self.actor_from_context(context),
            action=action,
            target_type=target_type,
            target_id=target_id,
            outcome="denied",
            request=request,
            metadata=metadata,
            workspace_id=None,
        )
        session.commit()
        raise HTTPException(status_code=403, detail="仅组织管理员可执行此操作")


class RequestContextService:
    def __init__(
        self,
        authentication_service: AuthenticationService,
        settings: Settings,
        audit_service: AuditService,
    ):
        self.authentication_service = authentication_service
        self.settings = settings
        self.audit_service = audit_service

    def organization_context(
        self,
        request: Request,
        session: Session,
    ) -> tuple[RequestContext, Session]:
        session_token = request.cookies.get(self.settings.session_cookie_name)
        try:
            user, session_record = self.authentication_service.authenticate_session(
                session,
                session_token,
            )
        except AuthenticationError as error:
            raise SessionAuthenticationError(str(error)) from None
        organization = session.get(OrganizationRecord, user.organization_id)
        if organization is None or organization.status != "active":
            raise SessionAuthenticationError("组织不可用")
        return RequestContext(
            user=user,
            organization=organization,
            workspace=None,
            membership=None,
            session=session_record,
        ), session

    def require_csrf(self, request: Request, context: RequestContext) -> None:
        csrf_token = request.headers.get("X-CSRF-Token")
        try:
            self.authentication_service.require_csrf(context.session, csrf_token)
        except CsrfError as error:
            raise HTTPException(status_code=403, detail=str(error)) from None

    def write_organization_context(
        self,
        request: Request,
        session: Session,
    ) -> tuple[RequestContext, Session]:
        context, session = self.organization_context(request, session)
        self.require_csrf(request, context)
        return context, session

    def workspace_context(
        self,
        workspace_id: str,
        request: Request,
        session: Session,
    ) -> tuple[RequestContext, Session]:
        context, session = self.organization_context(request, session)
        workspace = session.get(WorkspaceRecord, workspace_id)
        if (
            workspace is None
            or workspace.organization_id != context.organization.id
            or workspace.status != "active"
        ):
            raise HTTPException(status_code=404, detail="Workspace 不存在")
        membership = None
        if not context.user.is_organization_admin:
            membership = session.scalar(
                select(WorkspaceMembershipRecord).where(
                    WorkspaceMembershipRecord.workspace_id == workspace.id,
                    WorkspaceMembershipRecord.user_id == context.user.id,
                    WorkspaceMembershipRecord.status == "active",
                ),
            )
            if membership is None:
                self.audit_service.record(
                    session,
                    actor=AuditActor(
                        organization_id=context.organization.id,
                        workspace_id=workspace.id,
                        actor_user_id=context.user.id,
                        session_id=context.session.id,
                    ),
                    action="workspace.access_denied",
                    target_type="workspace",
                    target_id=workspace.id,
                    outcome="denied",
                    request=request,
                    workspace_id=workspace.id,
                )
                session.commit()
                raise HTTPException(status_code=404, detail="Workspace 不存在")
        return replace(context, workspace=workspace, membership=membership), session

    def write_workspace_context(
        self,
        workspace_id: str,
        request: Request,
        session: Session,
    ) -> tuple[RequestContext, Session]:
        context, session = self.workspace_context(workspace_id, request, session)
        self.require_csrf(request, context)
        return context, session
