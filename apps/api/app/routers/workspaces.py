from fastapi import APIRouter, Depends, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.access import AuthorizationService, RequestContext, RequestContextService
from app.audit import AuditService
from app.models import WorkspaceMembershipRecord, WorkspaceRecord, utc_now
from app.schemas import WorkspaceCreate, WorkspaceRead


def create_workspaces_router(
    get_session,
    context_service: RequestContextService,
    authorization_service: AuthorizationService,
    audit_service: AuditService,
) -> APIRouter:
    router = APIRouter(prefix="/api/workspaces", tags=["workspaces"])

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
        audit_service.record(
            session,
            actor=authorization_service.actor_from_context(context),
            action="workspace.create",
            target_type="workspace",
            target_id=workspace.id,
            outcome="success",
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

    return router
