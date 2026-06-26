from collections.abc import Callable, Iterator
from datetime import datetime

from fastapi import APIRouter, Body, Depends, FastAPI, HTTPException, Query, Request, status
from sqlalchemy import func, select
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.access import AuthorizationService, RequestContext, RequestContextService
from app.audit import AuditService
from app.auth import AuthenticationService
from app.config import Settings
from app.database import create_database, session_scope
from app.domain import next_version, validate_workflow
from app.execution import ExecutionService, WorkflowResumeService
from app.human_tasks import HumanTaskConflict, HumanTaskPermission, HumanTaskService, HumanTaskValidation
from app.migrations import ensure_current_schema
from app.model_gateway import ModelGateway, OpenAICompatibleGateway
from app.models import (
    AgentRecord,
    AgentVersionRecord,
    Base,
    HumanReviewRecord,
    HumanTaskRecord,
    NodeRunRecord,
    ReviewerRecord,
    WorkspaceRecord,
    WorkflowRecord,
    WorkflowRunRecord,
    WorkflowVersionRecord,
    utc_now,
)
from app.routers.auth import (
    SessionAuthenticationError,
    build_session_auth_error_handler,
    create_auth_router,
)
from app.routers.workspaces import create_workspaces_router
from app.schemas import (
    AgentCreate,
    AgentRead,
    AgentUpdate,
    FeedbackCandidateRead,
    GoldenSampleConfirm,
    GoldenSampleRead,
    HumanReviewRead,
    HumanTaskClaim,
    HumanTaskDecisionCreate,
    HumanTaskDetailRead,
    HumanTaskRead,
    HumanTaskTransfer,
    NodeRunRead,
    ReviewerRead,
    ReviewGroupRead,
    ReviewDecision,
    RunCreate,
    RunRead,
    ValidationResult,
    VersionRead,
    WorkflowCreate,
    WorkflowRead,
    WorkflowUpdate,
)
from app.security import SecurityService


def create_app(
    database_url: str | None = None,
    model_gateway: ModelGateway | None = None,
    human_task_clock: Callable[[], datetime] = utc_now,
    auth_clock: Callable[[], datetime] = utc_now,
) -> FastAPI:
    settings = Settings()
    resolved_database_url = database_url or settings.database_url
    engine, session_factory = create_database(resolved_database_url)
    try:
        Base.metadata.create_all(engine)
    except OperationalError as error:
        if "already exists" not in str(error):
            raise
    ensure_current_schema(engine)
    app = FastAPI(title="ARC.ONE API")
    app.add_exception_handler(
        SessionAuthenticationError,
        build_session_auth_error_handler(settings),
    )
    authentication_service = AuthenticationService(
        SecurityService(),
        settings,
        clock=auth_clock,
    )
    audit_service = AuditService()
    authorization_service = AuthorizationService(audit_service)
    context_service = RequestContextService(authentication_service, settings, audit_service)
    human_task_service = HumanTaskService(human_task_clock)
    execution_service = ExecutionService(
        model_gateway or OpenAICompatibleGateway(settings),
        settings,
        human_task_service,
    )
    workflow_resume_service = WorkflowResumeService(
        execution_service,
        human_task_service,
    )
    with session_factory() as session:
        workspace_ids = list(
            session.scalars(
                select(WorkspaceRecord.id).where(WorkspaceRecord.status == "active"),
            ),
        )
        for workspace_id in workspace_ids:
            human_task_service.ensure_default_directory(session, workspace_id)

    def get_session() -> Iterator[Session]:
        yield from session_scope(session_factory)

    app.state.session_factory = session_factory
    app.state.authentication_service = authentication_service
    app.include_router(
        create_auth_router(
            get_session,
            authentication_service,
            settings,
        ),
    )
    app.include_router(
        create_workspaces_router(
            get_session,
            context_service,
            authorization_service,
            audit_service,
        ),
    )

    def organization_context(
        request: Request,
        session: Session = Depends(get_session),
    ) -> tuple[RequestContext, Session]:
        return context_service.organization_context(request, session)

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

    router = APIRouter(prefix="/api/workspaces/{workspace_id}", tags=["workspace-api"])

    def record_success(
        session: Session,
        context: RequestContext,
        *,
        action: str,
        target_type: str,
        target_id: str | None,
        request: Request,
    ) -> None:
        audit_service.record(
            session,
            actor=authorization_service.actor_from_context(context),
            action=action,
            target_type=target_type,
            target_id=target_id,
            outcome="success",
            request=request,
        )

    def find_agent(workspace_id: str, agent_id: str, session: Session) -> AgentRecord:
        agent = session.scalar(
            select(AgentRecord).where(
                AgentRecord.id == agent_id,
                AgentRecord.workspace_id == workspace_id,
            ),
        )
        if agent is None:
            raise HTTPException(status_code=404, detail="Agent 不存在")
        return agent

    def agent_snapshot(record: AgentRecord) -> dict:
        return AgentRead.model_validate(record).model_dump(by_alias=True, mode="json")

    def find_workflow(workspace_id: str, workflow_id: str, session: Session) -> WorkflowRecord:
        workflow = session.scalar(
            select(WorkflowRecord).where(
                WorkflowRecord.id == workflow_id,
                WorkflowRecord.workspace_id == workspace_id,
            ),
        )
        if workflow is None:
            raise HTTPException(status_code=404, detail="工作流不存在")
        return workflow

    def workflow_snapshot(record: WorkflowRecord) -> dict:
        return WorkflowRead.model_validate(record).model_dump(by_alias=True, mode="json")

    def find_run(workspace_id: str, run_id: str, session: Session) -> WorkflowRunRecord:
        run = session.scalar(
            select(WorkflowRunRecord).where(
                WorkflowRunRecord.id == run_id,
                WorkflowRunRecord.workspace_id == workspace_id,
            ),
        )
        if run is None:
            raise HTTPException(status_code=404, detail="运行实例不存在")
        return run

    def find_review(
        workspace_id: str,
        review_id: str,
        session: Session,
    ) -> HumanReviewRecord:
        review = session.scalar(
            select(HumanReviewRecord).where(
                HumanReviewRecord.id == review_id,
                HumanReviewRecord.workspace_id == workspace_id,
            ),
        )
        if review is None:
            raise HTTPException(status_code=404, detail="人工审核任务不存在")
        return review

    def run_response(run: WorkflowRunRecord, session: Session) -> RunRead:
        nodes = list(session.scalars(
            select(NodeRunRecord)
            .where(NodeRunRecord.run_id == run.id)
            .order_by(NodeRunRecord.started_at.asc()),
        ))
        payload = RunRead.model_validate(run)
        return payload.model_copy(
            update={"nodes": [NodeRunRead.model_validate(node) for node in nodes]},
        )

    @router.get("/agents", response_model=list[AgentRead])
    def list_agents(
        request: Request,
        context_bundle: tuple[RequestContext, Session] = Depends(workspace_context),
    ) -> list[AgentRecord]:
        context, session = context_bundle
        authorization_service.require_capability(
            session,
            context,
            "asset.read",
            action="agent.list",
            target_type="workspace",
            target_id=context.workspace.id,
            request=request,
        )
        statement = (
            select(AgentRecord)
            .where(AgentRecord.workspace_id == context.workspace.id)
            .order_by(AgentRecord.created_at.desc())
        )
        return list(session.scalars(statement))

    @router.post("/agents", response_model=AgentRead, status_code=status.HTTP_201_CREATED)
    def create_agent(
        payload: AgentCreate,
        request: Request,
        context_bundle: tuple[RequestContext, Session] = Depends(write_workspace_context),
    ) -> AgentRecord:
        context, session = context_bundle
        authorization_service.require_capability(
            session,
            context,
            "agent.write",
            action="agent.create",
            target_type="agent",
            target_id=None,
            request=request,
        )
        now = utc_now()
        record = AgentRecord(
            workspace_id=context.workspace.id,
            **payload.model_dump(),
            created_at=now,
            updated_at=now,
        )
        session.add(record)
        session.flush()
        record_success(
            session,
            context,
            action="agent.create",
            target_type="agent",
            target_id=record.id,
            request=request,
        )
        session.commit()
        session.refresh(record)
        return record

    @router.get("/agents/{agent_id}", response_model=AgentRead)
    def get_agent(
        agent_id: str,
        request: Request,
        context_bundle: tuple[RequestContext, Session] = Depends(workspace_context),
    ) -> AgentRecord:
        context, session = context_bundle
        authorization_service.require_capability(
            session,
            context,
            "asset.read",
            action="agent.read",
            target_type="agent",
            target_id=agent_id,
            request=request,
        )
        return find_agent(context.workspace.id, agent_id, session)

    @router.patch("/agents/{agent_id}", response_model=AgentRead)
    def update_agent(
        agent_id: str,
        payload: AgentUpdate,
        request: Request,
        context_bundle: tuple[RequestContext, Session] = Depends(write_workspace_context),
    ) -> AgentRecord:
        context, session = context_bundle
        authorization_service.require_capability(
            session,
            context,
            "agent.write",
            action="agent.update",
            target_type="agent",
            target_id=agent_id,
            request=request,
        )
        record = find_agent(context.workspace.id, agent_id, session)
        if record.status == "宸插仠鐢?":
            raise HTTPException(status_code=409, detail="宸插仠鐢?Agent 不允许编辑")
        for field, value in payload.model_dump(exclude_unset=True).items():
            setattr(record, field, value)
        record.updated_at = utc_now()
        record_success(
            session,
            context,
            action="agent.update",
            target_type="agent",
            target_id=record.id,
            request=request,
        )
        session.commit()
        session.refresh(record)
        return record

    @router.get("/agents/{agent_id}/versions", response_model=list[VersionRead])
    def list_agent_versions(
        agent_id: str,
        request: Request,
        context_bundle: tuple[RequestContext, Session] = Depends(workspace_context),
    ) -> list[AgentVersionRecord]:
        context, session = context_bundle
        authorization_service.require_capability(
            session,
            context,
            "asset.read",
            action="agent.version.list",
            target_type="agent",
            target_id=agent_id,
            request=request,
        )
        find_agent(context.workspace.id, agent_id, session)
        statement = (
            select(AgentVersionRecord)
            .where(
                AgentVersionRecord.agent_id == agent_id,
                AgentVersionRecord.workspace_id == context.workspace.id,
            )
            .order_by(AgentVersionRecord.created_at.desc())
        )
        return list(session.scalars(statement))

    @router.post(
        "/agents/{agent_id}/publish",
        response_model=VersionRead,
        status_code=status.HTTP_201_CREATED,
    )
    def publish_agent(
        agent_id: str,
        request: Request,
        context_bundle: tuple[RequestContext, Session] = Depends(write_workspace_context),
    ) -> AgentVersionRecord:
        context, session = context_bundle
        authorization_service.require_capability(
            session,
            context,
            "agent.publish",
            action="agent.publish",
            target_type="agent",
            target_id=agent_id,
            request=request,
        )
        record = find_agent(context.workspace.id, agent_id, session)
        if record.status == "宸插仠鐢?":
            raise HTTPException(status_code=409, detail="宸插仠鐢?Agent 不允许发布")
        count = session.scalar(
            select(func.count()).select_from(AgentVersionRecord).where(
                AgentVersionRecord.agent_id == agent_id,
                AgentVersionRecord.workspace_id == context.workspace.id,
            ),
        ) or 0
        version = next_version(count)
        published = AgentVersionRecord(
            workspace_id=context.workspace.id,
            agent_id=agent_id,
            version=version,
            snapshot=agent_snapshot(record),
        )
        record.version = version
        record.status = "鍦ㄧ嚎"
        record.updated_at = utc_now()
        session.add(published)
        session.flush()
        record_success(
            session,
            context,
            action="agent.publish",
            target_type="agent",
            target_id=record.id,
            request=request,
        )
        session.commit()
        session.refresh(published)
        return published

    @router.post("/agents/{agent_id}/deactivate", response_model=AgentRead)
    def deactivate_agent(
        agent_id: str,
        request: Request,
        context_bundle: tuple[RequestContext, Session] = Depends(write_workspace_context),
    ) -> AgentRecord:
        context, session = context_bundle
        authorization_service.require_capability(
            session,
            context,
            "asset.deactivate",
            action="agent.deactivate",
            target_type="agent",
            target_id=agent_id,
            request=request,
        )
        record = find_agent(context.workspace.id, agent_id, session)
        record.status = "宸插仠鐢?"
        record.updated_at = utc_now()
        record_success(
            session,
            context,
            action="agent.deactivate",
            target_type="agent",
            target_id=record.id,
            request=request,
        )
        session.commit()
        session.refresh(record)
        return record

    @router.post(
        "/agents/{agent_id}/test-runs",
        response_model=RunRead,
        status_code=status.HTTP_201_CREATED,
    )
    def test_run_agent(
        agent_id: str,
        payload: RunCreate,
        request: Request,
        context_bundle: tuple[RequestContext, Session] = Depends(write_workspace_context),
    ) -> RunRead:
        context, session = context_bundle
        authorization_service.require_capability(
            session,
            context,
            "run.execute",
            action="agent.test_run",
            target_type="agent",
            target_id=agent_id,
            request=request,
        )
        agent = find_agent(context.workspace.id, agent_id, session)
        version = payload.version or agent.version
        if version == "v0.1.0":
            raise HTTPException(status_code=422, detail="请先发布 Agent 版本")
        try:
            run = execution_service.run_agent_version(
                session=session,
                agent_id=agent_id,
                agent_version=version,
                input_text=payload.input,
            )
        except RuntimeError as error:
            raise HTTPException(status_code=422, detail=str(error)) from None
        record_success(
            session,
            context,
            action="agent.test_run",
            target_type="agent",
            target_id=agent_id,
            request=request,
        )
        return run_response(run, session)

    @router.get("/workflows", response_model=list[WorkflowRead])
    def list_workflows(
        request: Request,
        context_bundle: tuple[RequestContext, Session] = Depends(workspace_context),
    ) -> list[WorkflowRecord]:
        context, session = context_bundle
        authorization_service.require_capability(
            session,
            context,
            "asset.read",
            action="workflow.list",
            target_type="workspace",
            target_id=context.workspace.id,
            request=request,
        )
        statement = (
            select(WorkflowRecord)
            .where(WorkflowRecord.workspace_id == context.workspace.id)
            .order_by(WorkflowRecord.updated_at.desc())
        )
        return list(session.scalars(statement))

    @router.post("/workflows", response_model=WorkflowRead, status_code=status.HTTP_201_CREATED)
    def create_workflow(
        payload: WorkflowCreate,
        request: Request,
        context_bundle: tuple[RequestContext, Session] = Depends(write_workspace_context),
    ) -> WorkflowRecord:
        context, session = context_bundle
        authorization_service.require_capability(
            session,
            context,
            "workflow.write",
            action="workflow.create",
            target_type="workflow",
            target_id=None,
            request=request,
        )
        now = utc_now()
        record = WorkflowRecord(
            workspace_id=context.workspace.id,
            name=payload.name.strip(),
            nodes=[node.model_dump() for node in payload.nodes],
            edges=[edge.model_dump(exclude_none=True) for edge in payload.edges],
            created_at=now,
            updated_at=now,
        )
        session.add(record)
        session.flush()
        record_success(
            session,
            context,
            action="workflow.create",
            target_type="workflow",
            target_id=record.id,
            request=request,
        )
        session.commit()
        session.refresh(record)
        return record

    @router.get("/workflows/{workflow_id}", response_model=WorkflowRead)
    def get_workflow(
        workflow_id: str,
        request: Request,
        context_bundle: tuple[RequestContext, Session] = Depends(workspace_context),
    ) -> WorkflowRecord:
        context, session = context_bundle
        authorization_service.require_capability(
            session,
            context,
            "asset.read",
            action="workflow.read",
            target_type="workflow",
            target_id=workflow_id,
            request=request,
        )
        return find_workflow(context.workspace.id, workflow_id, session)

    @router.patch("/workflows/{workflow_id}", response_model=WorkflowRead)
    def update_workflow(
        workflow_id: str,
        payload: WorkflowUpdate,
        request: Request,
        context_bundle: tuple[RequestContext, Session] = Depends(write_workspace_context),
    ) -> WorkflowRecord:
        context, session = context_bundle
        authorization_service.require_capability(
            session,
            context,
            "workflow.write",
            action="workflow.update",
            target_type="workflow",
            target_id=workflow_id,
            request=request,
        )
        record = find_workflow(context.workspace.id, workflow_id, session)
        record.name = payload.name.strip()
        record.nodes = [node.model_dump() for node in payload.nodes]
        record.edges = [edge.model_dump(exclude_none=True) for edge in payload.edges]
        record.status = "鑽夌"
        record.updated_at = utc_now()
        record_success(
            session,
            context,
            action="workflow.update",
            target_type="workflow",
            target_id=record.id,
            request=request,
        )
        session.commit()
        session.refresh(record)
        return record

    @router.post("/workflows/{workflow_id}/validate", response_model=ValidationResult)
    def validate_workflow_draft(
        workflow_id: str,
        request: Request,
        context_bundle: tuple[RequestContext, Session] = Depends(workspace_context),
    ) -> ValidationResult:
        context, session = context_bundle
        authorization_service.require_capability(
            session,
            context,
            "asset.read",
            action="workflow.validate",
            target_type="workflow",
            target_id=workflow_id,
            request=request,
        )
        record = find_workflow(context.workspace.id, workflow_id, session)
        errors = validate_workflow(record.nodes, record.edges, session)
        return ValidationResult(valid=not errors, errors=errors)

    @router.get("/workflows/{workflow_id}/versions", response_model=list[VersionRead])
    def list_workflow_versions(
        workflow_id: str,
        request: Request,
        context_bundle: tuple[RequestContext, Session] = Depends(workspace_context),
    ) -> list[WorkflowVersionRecord]:
        context, session = context_bundle
        authorization_service.require_capability(
            session,
            context,
            "asset.read",
            action="workflow.version.list",
            target_type="workflow",
            target_id=workflow_id,
            request=request,
        )
        find_workflow(context.workspace.id, workflow_id, session)
        statement = (
            select(WorkflowVersionRecord)
            .where(
                WorkflowVersionRecord.workflow_id == workflow_id,
                WorkflowVersionRecord.workspace_id == context.workspace.id,
            )
            .order_by(WorkflowVersionRecord.created_at.desc())
        )
        return list(session.scalars(statement))

    @router.post(
        "/workflows/{workflow_id}/publish",
        response_model=VersionRead,
        status_code=status.HTTP_201_CREATED,
    )
    def publish_workflow(
        workflow_id: str,
        request: Request,
        context_bundle: tuple[RequestContext, Session] = Depends(write_workspace_context),
    ) -> WorkflowVersionRecord:
        context, session = context_bundle
        authorization_service.require_capability(
            session,
            context,
            "workflow.publish",
            action="workflow.publish",
            target_type="workflow",
            target_id=workflow_id,
            request=request,
        )
        record = find_workflow(context.workspace.id, workflow_id, session)
        errors = validate_workflow(record.nodes, record.edges, session)
        if errors:
            raise HTTPException(status_code=422, detail=errors)
        count = session.scalar(
            select(func.count()).select_from(WorkflowVersionRecord).where(
                WorkflowVersionRecord.workflow_id == workflow_id,
                WorkflowVersionRecord.workspace_id == context.workspace.id,
            ),
        ) or 0
        version = next_version(count)
        published = WorkflowVersionRecord(
            workspace_id=context.workspace.id,
            workflow_id=workflow_id,
            version=version,
            snapshot=workflow_snapshot(record),
        )
        record.version = version
        record.status = "宸插彂甯?"
        record.updated_at = utc_now()
        session.add(published)
        session.flush()
        record_success(
            session,
            context,
            action="workflow.publish",
            target_type="workflow",
            target_id=record.id,
            request=request,
        )
        session.commit()
        session.refresh(published)
        return published

    @router.post(
        "/workflows/{workflow_id}/runs",
        response_model=RunRead,
        status_code=status.HTTP_201_CREATED,
    )
    def run_workflow(
        workflow_id: str,
        payload: RunCreate,
        request: Request,
        context_bundle: tuple[RequestContext, Session] = Depends(write_workspace_context),
    ) -> RunRead:
        context, session = context_bundle
        authorization_service.require_capability(
            session,
            context,
            "run.execute",
            action="run.execute",
            target_type="workflow",
            target_id=workflow_id,
            request=request,
        )
        workflow = find_workflow(context.workspace.id, workflow_id, session)
        version = payload.version or workflow.version
        if version == "鏈彂甯?":
            raise HTTPException(status_code=422, detail="请先发布工作流版本")
        try:
            run = execution_service.run_workflow_version(
                session=session,
                workflow_id=workflow_id,
                workflow_version=version,
                input_text=payload.input,
            )
        except RuntimeError as error:
            raise HTTPException(status_code=422, detail=str(error)) from None
        record_success(
            session,
            context,
            action="run.execute",
            target_type="workflow",
            target_id=workflow_id,
            request=request,
        )
        return run_response(run, session)

    @router.get("/runs", response_model=list[RunRead])
    def list_runs(
        request: Request,
        context_bundle: tuple[RequestContext, Session] = Depends(workspace_context),
    ) -> list[RunRead]:
        context, session = context_bundle
        authorization_service.require_capability(
            session,
            context,
            "run.read",
            action="run.list",
            target_type="workspace",
            target_id=context.workspace.id,
            request=request,
        )
        statement = (
            select(WorkflowRunRecord)
            .where(WorkflowRunRecord.workspace_id == context.workspace.id)
            .order_by(WorkflowRunRecord.started_at.desc())
        )
        return [run_response(run, session) for run in session.scalars(statement)]

    @router.get("/runs/{run_id}", response_model=RunRead)
    def get_run(
        run_id: str,
        request: Request,
        context_bundle: tuple[RequestContext, Session] = Depends(workspace_context),
    ) -> RunRead:
        context, session = context_bundle
        authorization_service.require_capability(
            session,
            context,
            "run.read",
            action="run.read",
            target_type="run",
            target_id=run_id,
            request=request,
        )
        return run_response(find_run(context.workspace.id, run_id, session), session)

    @router.get("/reviews", response_model=list[HumanReviewRead])
    def list_reviews(
        request: Request,
        context_bundle: tuple[RequestContext, Session] = Depends(workspace_context),
    ) -> list[HumanReviewRecord]:
        context, session = context_bundle
        authorization_service.require_capability(
            session,
            context,
            "asset.read",
            action="review.list",
            target_type="workspace",
            target_id=context.workspace.id,
            request=request,
        )
        statement = (
            select(HumanReviewRecord)
            .where(HumanReviewRecord.workspace_id == context.workspace.id)
            .order_by(HumanReviewRecord.created_at.desc())
        )
        return list(session.scalars(statement))

    @router.post("/reviews/{review_id}/decision", response_model=HumanReviewRead)
    def decide_review(
        review_id: str,
        payload: ReviewDecision,
        request: Request,
        context_bundle: tuple[RequestContext, Session] = Depends(write_workspace_context),
    ) -> HumanReviewRecord:
        context, session = context_bundle
        authorization_service.require_capability(
            session,
            context,
            "run.execute",
            action="review.decision",
            target_type="review",
            target_id=review_id,
            request=request,
        )
        review = find_review(context.workspace.id, review_id, session)
        run = find_run(context.workspace.id, review.run_id, session)
        if payload.decision == "approve":
            review.status = "宸插畬鎴?"
            run.status = "宸插畬鎴?"
        else:
            review.status = "宸查┏鍥?"
            run.status = "澶辫触"
            run.error = "人工审核已驳回"
        record_success(
            session,
            context,
            action="review.decision",
            target_type="review",
            target_id=review_id,
            request=request,
        )
        session.commit()
        session.refresh(review)
        return review

    @router.get("/human-tasks", response_model=list[HumanTaskRead])
    def list_human_tasks(
        request: Request,
        status: str | None = None,
        reviewer_id: str | None = Query(default=None, alias="reviewerId"),
        group_id: str | None = Query(default=None, alias="groupId"),
        sla_status: str | None = Query(default=None, alias="slaStatus"),
        active: bool = False,
        context_bundle: tuple[RequestContext, Session] = Depends(workspace_context),
    ) -> list[HumanTaskRecord]:
        context, session = context_bundle
        authorization_service.require_capability(
            session,
            context,
            "asset.read",
            action="human_task.list",
            target_type="workspace",
            target_id=context.workspace.id,
            request=request,
        )
        return human_task_service.list_tasks(
            session,
            context.workspace.id,
            status=status,
            reviewer_id=reviewer_id,
            group_id=group_id,
            sla_status=sla_status,
            active=active,
        )

    @router.get("/reviewers", response_model=list[ReviewerRead])
    def list_reviewers(
        request: Request,
        context_bundle: tuple[RequestContext, Session] = Depends(workspace_context),
    ) -> list[ReviewerRecord]:
        context, session = context_bundle
        authorization_service.require_capability(
            session,
            context,
            "asset.read",
            action="reviewer.list",
            target_type="workspace",
            target_id=context.workspace.id,
            request=request,
        )
        return human_task_service.list_reviewers(session, context.workspace.id)

    @router.get("/review-groups", response_model=list[ReviewGroupRead])
    def list_review_groups(
        request: Request,
        context_bundle: tuple[RequestContext, Session] = Depends(workspace_context),
    ) -> list[dict]:
        context, session = context_bundle
        authorization_service.require_capability(
            session,
            context,
            "asset.read",
            action="review_group.list",
            target_type="workspace",
            target_id=context.workspace.id,
            request=request,
        )
        return human_task_service.list_groups(session, context.workspace.id)

    @router.get("/human-tasks/{task_id}", response_model=HumanTaskDetailRead)
    def get_human_task(
        task_id: str,
        request: Request,
        context_bundle: tuple[RequestContext, Session] = Depends(workspace_context),
    ) -> dict:
        context, session = context_bundle
        authorization_service.require_capability(
            session,
            context,
            "asset.read",
            action="human_task.read",
            target_type="human_task",
            target_id=task_id,
            request=request,
        )
        detail = human_task_service.get_task_detail(session, context.workspace.id, task_id)
        if detail is None:
            raise HTTPException(status_code=404, detail="人工任务不存在")
        return detail

    @router.post("/human-tasks/{task_id}/claim", response_model=HumanTaskRead)
    def claim_human_task(
        task_id: str,
        request: Request,
        _payload: HumanTaskClaim = Body(default_factory=HumanTaskClaim),
        context_bundle: tuple[RequestContext, Session] = Depends(write_workspace_context),
    ) -> HumanTaskRecord:
        context, session = context_bundle
        try:
            reviewer = human_task_service.active_reviewer_for_user(
                session,
                context.workspace.id,
                context.user.id,
            )
            return human_task_service.claim_task(
                session,
                context.workspace.id,
                task_id,
                reviewer,
            )
        except HumanTaskConflict as error:
            raise HTTPException(status_code=409, detail=str(error)) from None
        except HumanTaskPermission as error:
            raise HTTPException(status_code=403, detail=str(error)) from None
        except HumanTaskValidation as error:
            raise HTTPException(status_code=422, detail=str(error)) from None

    @router.post("/human-tasks/{task_id}/transfer", response_model=HumanTaskRead)
    def transfer_human_task(
        task_id: str,
        payload: HumanTaskTransfer,
        request: Request,
        context_bundle: tuple[RequestContext, Session] = Depends(write_workspace_context),
    ) -> HumanTaskRecord:
        context, session = context_bundle
        try:
            actor_reviewer = human_task_service.active_reviewer_for_user(
                session,
                context.workspace.id,
                context.user.id,
            )
            return human_task_service.transfer_task(
                session,
                context.workspace.id,
                task_id,
                actor_reviewer=actor_reviewer,
                reviewer_id=payload.reviewer_id,
                group_id=payload.group_id,
                reason=payload.reason,
            )
        except HumanTaskConflict as error:
            raise HTTPException(status_code=409, detail=str(error)) from None
        except HumanTaskPermission as error:
            raise HTTPException(status_code=403, detail=str(error)) from None
        except HumanTaskValidation as error:
            raise HTTPException(status_code=422, detail=str(error)) from None

    @router.post("/human-tasks/{task_id}/decisions", response_model=HumanTaskDetailRead)
    def decide_human_task(
        task_id: str,
        payload: HumanTaskDecisionCreate,
        request: Request,
        context_bundle: tuple[RequestContext, Session] = Depends(write_workspace_context),
    ) -> dict:
        context, session = context_bundle
        try:
            reviewer = human_task_service.active_reviewer_for_user(
                session,
                context.workspace.id,
                context.user.id,
            )
            detail, decision, _ = human_task_service.decide_task(
                session,
                context.workspace.id,
                task_id,
                reviewer=reviewer,
                decision=payload.decision,
                reason=payload.reason,
                artifact_version_id=payload.artifact_version_id,
                idempotency_key=payload.idempotency_key,
                modified_content=payload.modified_content,
                tags=payload.tags,
            )
            if detail["status"] in {"宸查€氳繃", "淇敼鍚庨€氳繃", "宸查┏鍥?", "宸查€€鍥?"}:
                workflow_resume_service.apply_outcome(
                    session=session,
                    workspace_id=context.workspace.id,
                    task_id=task_id,
                    decision_id=decision.id,
                )
                refreshed = human_task_service.get_task_detail(
                    session,
                    context.workspace.id,
                    task_id,
                )
                if refreshed is None:
                    raise RuntimeError("人工任务详情不可用")
                return refreshed
            return detail
        except HumanTaskConflict as error:
            raise HTTPException(status_code=409, detail=str(error)) from None
        except HumanTaskPermission as error:
            raise HTTPException(status_code=403, detail=str(error)) from None
        except HumanTaskValidation as error:
            raise HTTPException(status_code=422, detail=str(error)) from None

    @router.post("/human-tasks/{task_id}/retry-resume", response_model=HumanTaskDetailRead)
    def retry_human_task_resume(
        task_id: str,
        request: Request,
        context_bundle: tuple[RequestContext, Session] = Depends(write_workspace_context),
    ) -> dict:
        context, session = context_bundle
        authorization_service.require_capability(
            session,
            context,
            "run.execute",
            action="human_task.retry_resume",
            target_type="human_task",
            target_id=task_id,
            request=request,
        )
        try:
            workflow_resume_service.retry(
                session=session,
                workspace_id=context.workspace.id,
                task_id=task_id,
            )
        except RuntimeError as error:
            raise HTTPException(status_code=409, detail=str(error)) from None
        detail = human_task_service.get_task_detail(session, context.workspace.id, task_id)
        if detail is None:
            raise HTTPException(status_code=404, detail="人工任务不存在")
        return detail

    @router.get("/feedback-candidates", response_model=list[FeedbackCandidateRead])
    def list_feedback_candidates(
        request: Request,
        context_bundle: tuple[RequestContext, Session] = Depends(workspace_context),
    ) -> list[dict]:
        context, session = context_bundle
        authorization_service.require_capability(
            session,
            context,
            "asset.read",
            action="feedback_candidate.list",
            target_type="workspace",
            target_id=context.workspace.id,
            request=request,
        )
        return human_task_service.list_feedback_candidates(session, context.workspace.id)

    @router.get(
        "/feedback-candidates/{candidate_id}",
        response_model=FeedbackCandidateRead,
    )
    def get_feedback_candidate(
        candidate_id: str,
        request: Request,
        context_bundle: tuple[RequestContext, Session] = Depends(workspace_context),
    ) -> dict:
        context, session = context_bundle
        authorization_service.require_capability(
            session,
            context,
            "asset.read",
            action="feedback_candidate.read",
            target_type="feedback_candidate",
            target_id=candidate_id,
            request=request,
        )
        candidate = human_task_service.get_feedback_candidate(
            session,
            context.workspace.id,
            candidate_id,
        )
        if candidate is None:
            raise HTTPException(status_code=404, detail="反馈候选不存在")
        return candidate

    @router.post(
        "/feedback-candidates/{candidate_id}/confirm",
        response_model=GoldenSampleRead,
        status_code=status.HTTP_201_CREATED,
    )
    def confirm_feedback_candidate(
        candidate_id: str,
        payload: GoldenSampleConfirm,
        request: Request,
        context_bundle: tuple[RequestContext, Session] = Depends(write_workspace_context),
    ):
        context, session = context_bundle
        try:
            reviewer = human_task_service.active_reviewer_for_user(
                session,
                context.workspace.id,
                context.user.id,
            )
            return human_task_service.confirm_feedback_candidate(
                session,
                context.workspace.id,
                candidate_id,
                reviewer=reviewer,
                reason=payload.reason,
                idempotency_key=payload.idempotency_key,
            )
        except HumanTaskConflict as error:
            raise HTTPException(status_code=409, detail=str(error)) from None
        except HumanTaskPermission as error:
            raise HTTPException(status_code=403, detail=str(error)) from None
        except HumanTaskValidation as error:
            raise HTTPException(status_code=422, detail=str(error)) from None

    app.include_router(router)
    return app


app = create_app()
