from collections.abc import Iterator

from fastapi import Depends, FastAPI, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.config import Settings
from app.database import create_database, session_scope
from app.domain import next_version, validate_workflow
from app.execution import ExecutionService
from app.migrations import ensure_current_schema
from app.model_gateway import ModelGateway, OpenAICompatibleGateway
from app.models import (
    AgentRecord,
    AgentVersionRecord,
    Base,
    WorkflowRecord,
    WorkflowRunRecord,
    WorkflowVersionRecord,
    HumanReviewRecord,
    NodeRunRecord,
    utc_now,
)
from app.schemas import (
    AgentCreate,
    AgentRead,
    AgentUpdate,
    HumanReviewRead,
    NodeRunRead,
    ReviewDecision,
    RunCreate,
    RunRead,
    ValidationResult,
    VersionRead,
    WorkflowCreate,
    WorkflowRead,
    WorkflowUpdate,
)


def create_app(
    database_url: str | None = None,
    model_gateway: ModelGateway | None = None,
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
    execution_service = ExecutionService(
        model_gateway or OpenAICompatibleGateway(settings),
        settings,
    )

    def get_session() -> Iterator[Session]:
        yield from session_scope(session_factory)

    @app.get("/api/agents", response_model=list[AgentRead])
    def list_agents(session: Session = Depends(get_session)) -> list[AgentRecord]:
        statement = select(AgentRecord).order_by(AgentRecord.created_at.desc())
        return list(session.scalars(statement))

    def find_agent(agent_id: str, session: Session) -> AgentRecord:
        agent = session.get(AgentRecord, agent_id)
        if agent is None:
            raise HTTPException(status_code=404, detail="Agent 不存在")
        return agent

    def agent_snapshot(record: AgentRecord) -> dict:
        return AgentRead.model_validate(record).model_dump(by_alias=True, mode="json")

    @app.post(
        "/api/agents",
        response_model=AgentRead,
        status_code=status.HTTP_201_CREATED,
    )
    def create_agent(
        agent: AgentCreate,
        session: Session = Depends(get_session),
    ) -> AgentRecord:
        now = utc_now()
        record = AgentRecord(
            **agent.model_dump(),
            created_at=now,
            updated_at=now,
        )
        session.add(record)
        session.commit()
        session.refresh(record)
        return record

    @app.get("/api/agents/{agent_id}", response_model=AgentRead)
    def get_agent(agent_id: str, session: Session = Depends(get_session)) -> AgentRecord:
        return find_agent(agent_id, session)

    @app.patch("/api/agents/{agent_id}", response_model=AgentRead)
    def update_agent(
        agent_id: str,
        update: AgentUpdate,
        session: Session = Depends(get_session),
    ) -> AgentRecord:
        record = find_agent(agent_id, session)
        if record.status == "已停用":
            raise HTTPException(status_code=409, detail="已停用 Agent 不允许编辑")
        for field, value in update.model_dump(exclude_unset=True).items():
            setattr(record, field, value)
        record.updated_at = utc_now()
        session.commit()
        session.refresh(record)
        return record

    @app.get("/api/agents/{agent_id}/versions", response_model=list[VersionRead])
    def list_agent_versions(
        agent_id: str,
        session: Session = Depends(get_session),
    ) -> list[AgentVersionRecord]:
        find_agent(agent_id, session)
        statement = (
            select(AgentVersionRecord)
            .where(AgentVersionRecord.agent_id == agent_id)
            .order_by(AgentVersionRecord.created_at.desc())
        )
        return list(session.scalars(statement))

    @app.post(
        "/api/agents/{agent_id}/publish",
        response_model=VersionRead,
        status_code=status.HTTP_201_CREATED,
    )
    def publish_agent(
        agent_id: str,
        session: Session = Depends(get_session),
    ) -> AgentVersionRecord:
        record = find_agent(agent_id, session)
        if record.status == "已停用":
            raise HTTPException(status_code=409, detail="已停用 Agent 不允许发布")
        count = session.scalar(
            select(func.count()).select_from(AgentVersionRecord).where(
                AgentVersionRecord.agent_id == agent_id,
            ),
        ) or 0
        version = next_version(count)
        published = AgentVersionRecord(
            agent_id=agent_id,
            version=version,
            snapshot=agent_snapshot(record),
        )
        record.version = version
        record.status = "在线"
        record.updated_at = utc_now()
        session.add(published)
        session.commit()
        session.refresh(published)
        return published

    @app.post("/api/agents/{agent_id}/deactivate", response_model=AgentRead)
    def deactivate_agent(
        agent_id: str,
        session: Session = Depends(get_session),
    ) -> AgentRecord:
        record = find_agent(agent_id, session)
        record.status = "已停用"
        record.updated_at = utc_now()
        session.commit()
        session.refresh(record)
        return record

    def find_workflow(workflow_id: str, session: Session) -> WorkflowRecord:
        workflow = session.get(WorkflowRecord, workflow_id)
        if workflow is None:
            raise HTTPException(status_code=404, detail="工作流不存在")
        return workflow

    def workflow_snapshot(record: WorkflowRecord) -> dict:
        return WorkflowRead.model_validate(record).model_dump(by_alias=True, mode="json")

    @app.get("/api/workflows", response_model=list[WorkflowRead])
    def list_workflows(session: Session = Depends(get_session)) -> list[WorkflowRecord]:
        statement = select(WorkflowRecord).order_by(WorkflowRecord.updated_at.desc())
        return list(session.scalars(statement))

    @app.post("/api/workflows", response_model=WorkflowRead, status_code=status.HTTP_201_CREATED)
    def create_workflow(
        workflow: WorkflowCreate,
        session: Session = Depends(get_session),
    ) -> WorkflowRecord:
        now = utc_now()
        record = WorkflowRecord(
            name=workflow.name.strip(),
            nodes=[node.model_dump() for node in workflow.nodes],
            edges=[edge.model_dump(exclude_none=True) for edge in workflow.edges],
            created_at=now,
            updated_at=now,
        )
        session.add(record)
        session.commit()
        session.refresh(record)
        return record

    @app.get("/api/workflows/{workflow_id}", response_model=WorkflowRead)
    def get_workflow(
        workflow_id: str,
        session: Session = Depends(get_session),
    ) -> WorkflowRecord:
        return find_workflow(workflow_id, session)

    @app.patch("/api/workflows/{workflow_id}", response_model=WorkflowRead)
    def update_workflow(
        workflow_id: str,
        update: WorkflowUpdate,
        session: Session = Depends(get_session),
    ) -> WorkflowRecord:
        record = find_workflow(workflow_id, session)
        record.name = update.name.strip()
        record.nodes = [node.model_dump() for node in update.nodes]
        record.edges = [edge.model_dump(exclude_none=True) for edge in update.edges]
        record.status = "草稿"
        record.updated_at = utc_now()
        session.commit()
        session.refresh(record)
        return record

    @app.post("/api/workflows/{workflow_id}/validate", response_model=ValidationResult)
    def validate_workflow_draft(
        workflow_id: str,
        session: Session = Depends(get_session),
    ) -> ValidationResult:
        record = find_workflow(workflow_id, session)
        errors = validate_workflow(record.nodes, record.edges, session)
        return ValidationResult(valid=not errors, errors=errors)

    @app.get("/api/workflows/{workflow_id}/versions", response_model=list[VersionRead])
    def list_workflow_versions(
        workflow_id: str,
        session: Session = Depends(get_session),
    ) -> list[WorkflowVersionRecord]:
        find_workflow(workflow_id, session)
        statement = (
            select(WorkflowVersionRecord)
            .where(WorkflowVersionRecord.workflow_id == workflow_id)
            .order_by(WorkflowVersionRecord.created_at.desc())
        )
        return list(session.scalars(statement))

    @app.post(
        "/api/workflows/{workflow_id}/publish",
        response_model=VersionRead,
        status_code=status.HTTP_201_CREATED,
    )
    def publish_workflow(
        workflow_id: str,
        session: Session = Depends(get_session),
    ) -> WorkflowVersionRecord:
        record = find_workflow(workflow_id, session)
        errors = validate_workflow(record.nodes, record.edges, session)
        if errors:
            raise HTTPException(status_code=422, detail=errors)
        count = session.scalar(
            select(func.count()).select_from(WorkflowVersionRecord).where(
                WorkflowVersionRecord.workflow_id == workflow_id,
            ),
        ) or 0
        version = next_version(count)
        published = WorkflowVersionRecord(
            workflow_id=workflow_id,
            version=version,
            snapshot=workflow_snapshot(record),
        )
        record.version = version
        record.status = "已发布"
        record.updated_at = utc_now()
        session.add(published)
        session.commit()
        session.refresh(published)
        return published

    def run_response(run: WorkflowRunRecord, session: Session) -> RunRead:
        nodes = list(session.scalars(
            select(NodeRunRecord)
            .where(NodeRunRecord.run_id == run.id)
            .order_by(NodeRunRecord.started_at.asc()),
        ))
        payload = RunRead.model_validate(run)
        return payload.model_copy(
            update={"nodes": [NodeRunRead.model_validate(node) for node in nodes]}
        )

    @app.post(
        "/api/agents/{agent_id}/test-runs",
        response_model=RunRead,
        status_code=status.HTTP_201_CREATED,
    )
    def test_run_agent(
        agent_id: str,
        request: RunCreate,
        session: Session = Depends(get_session),
    ) -> dict:
        agent = find_agent(agent_id, session)
        version = request.version or agent.version
        if version == "v0.1.0":
            raise HTTPException(status_code=422, detail="请先发布 Agent 版本")
        try:
            run = execution_service.run_agent_version(
                session=session,
                agent_id=agent_id,
                agent_version=version,
                input_text=request.input,
            )
        except RuntimeError as error:
            raise HTTPException(status_code=422, detail=str(error)) from None
        return run_response(run, session)

    @app.post(
        "/api/workflows/{workflow_id}/runs",
        response_model=RunRead,
        status_code=status.HTTP_201_CREATED,
    )
    def run_workflow(
        workflow_id: str,
        request: RunCreate,
        session: Session = Depends(get_session),
    ) -> dict:
        workflow = find_workflow(workflow_id, session)
        version = request.version or workflow.version
        if version == "未发布":
            raise HTTPException(status_code=422, detail="请先发布工作流版本")
        try:
            run = execution_service.run_workflow_version(
                session=session,
                workflow_id=workflow_id,
                workflow_version=version,
                input_text=request.input,
            )
        except RuntimeError as error:
            raise HTTPException(status_code=422, detail=str(error)) from None
        return run_response(run, session)

    @app.get("/api/runs", response_model=list[RunRead])
    def list_runs(session: Session = Depends(get_session)) -> list[dict]:
        statement = select(WorkflowRunRecord).order_by(WorkflowRunRecord.started_at.desc())
        return [run_response(run, session) for run in session.scalars(statement)]

    @app.get("/api/runs/{run_id}", response_model=RunRead)
    def get_run(run_id: str, session: Session = Depends(get_session)) -> dict:
        run = session.get(WorkflowRunRecord, run_id)
        if run is None:
            raise HTTPException(status_code=404, detail="运行实例不存在")
        return run_response(run, session)

    @app.get("/api/reviews", response_model=list[HumanReviewRead])
    def list_reviews(session: Session = Depends(get_session)) -> list[HumanReviewRecord]:
        statement = select(HumanReviewRecord).order_by(HumanReviewRecord.created_at.desc())
        return list(session.scalars(statement))

    @app.post("/api/reviews/{review_id}/decision", response_model=HumanReviewRead)
    def decide_review(
        review_id: str,
        request: ReviewDecision,
        session: Session = Depends(get_session),
    ) -> HumanReviewRecord:
        review = session.get(HumanReviewRecord, review_id)
        if review is None:
            raise HTTPException(status_code=404, detail="人工审核任务不存在")
        run = session.get(WorkflowRunRecord, review.run_id)
        if run is None:
            raise HTTPException(status_code=404, detail="关联运行实例不存在")
        if request.decision == "approve":
            review.status = "已完成"
            run.status = "已完成"
        else:
            review.status = "已驳回"
            run.status = "失败"
            run.error = "人工审核已驳回"
        session.commit()
        session.refresh(review)
        return review

    return app


app = create_app()
