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
    AuditEventRecord,
    Base,
    FeedbackCandidateRecord,
    GoldenSampleRecord,
    HumanReviewRecord,
    HumanTaskRecord,
    NodeRunRecord,
    NotificationOutboxRecord,
    ReviewerRecord,
    ReviewGroupRecord,
    RubricRecord,
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
    EvaluationOverviewRead,
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
    ObservabilityAuditEventRead,
    ObservabilityAlertRead,
    ObservabilityCostUsageGroupRead,
    ObservabilityCostUsageRead,
    ObservabilityCostUsageTotalsRead,
    ObservabilityHumanSlaGroupRead,
    ObservabilityHumanSlaOverviewRead,
    ObservabilityHumanSlaReviewerRead,
    ObservabilityHumanSlaRiskRead,
    ObservabilityHumanSlaTotalsRead,
    ObservabilityHumanTaskRead,
    ObservabilityNodeRunRead,
    ObservabilityOverviewRead,
    ObservabilityRiskRead,
    ObservabilityRunDetailRead,
    ObservabilityRunSummaryRead,
    ObservabilityTotalsRead,
    ReviewerRead,
    ReviewGroupRead,
    ReviewDecision,
    RubricRead,
    RunCreate,
    RunRead,
    ValidationResult,
    VersionRead,
    WorkflowCreate,
    WorkflowRead,
    WorkflowUpdate,
)
from app.security import SecurityService


DEFAULT_RUBRICS = (
    {
        "name": "竞品分析质量标准",
        "artifact": "竞品分析矩阵",
        "dimensions": [
            {"name": "事实准确性", "weight": 25},
            {"name": "信息完整性", "weight": 20},
            {"name": "洞察价值", "weight": 25},
            {"name": "业务相关性", "weight": 15},
            {"name": "结构与复用", "weight": 10},
            {"name": "风险控制", "weight": 5},
        ],
        "gate": "来源完整率 = 100%，竞品数量 >= 5",
        "pass_score": 85,
        "version": "v2.1",
        "status": "active",
    },
    {
        "name": "需求洞察质量标准",
        "artifact": "用户需求对象",
        "dimensions": [
            {"name": "证据可信度", "weight": 30},
            {"name": "需求聚类质量", "weight": 20},
            {"name": "场景完整性", "weight": 20},
            {"name": "机会可行动性", "weight": 20},
            {"name": "可追溯性", "weight": 10},
        ],
        "gate": "每条结论至少关联 3 条原始证据",
        "pass_score": 80,
        "version": "v1.6",
        "status": "active",
    },
    {
        "name": "产品定义准入标准",
        "artifact": "产品定义文档",
        "dimensions": [
            {"name": "战略一致性", "weight": 25},
            {"name": "用户价值", "weight": 25},
            {"name": "技术可行性", "weight": 20},
            {"name": "商业潜力", "weight": 20},
            {"name": "风险完备性", "weight": 10},
        ],
        "gate": "关键指标、目标用户、成本边界均不得为空",
        "pass_score": 88,
        "version": "v0.9",
        "status": "active",
    },
)


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
            clock=auth_clock,
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

    def observability_priority(run: WorkflowRunRecord) -> tuple[int, str]:
        if run.status in {"失败", "澶辫触"}:
            return (0, "critical")
        if run.status == "恢复失败":
            return (1, "critical")
        if run.status in {"需介入", "等待审核", "绛夊緟瀹℃牳"}:
            return (2, "warning")
        if run.status in {"运行中", "等待中"}:
            return (3, "warning")
        return (4, "normal")

    def observability_next_action(run: WorkflowRunRecord) -> str:
        if run.status in {"失败", "澶辫触"}:
            return "查看失败节点和错误信息"
        if run.status == "恢复失败":
            return "进入人工审核重试恢复"
        if run.status in {"需介入", "等待审核", "绛夊緟瀹℃牳"}:
            return "进入人工审核处理 Human Task"
        if run.status in {"运行中", "等待中"}:
            return "等待运行完成或刷新状态"
        return "查看产出物和节点耗时"

    def observability_failure_classification(run: WorkflowRunRecord) -> tuple[str, str, str]:
        text = " ".join([
            run.status or "",
            run.current_node or "",
            run.error or "",
        ]).lower()

        if run.status == "恢复失败":
            return (
                "resume_failed",
                "恢复执行失败",
                "检查人工审核决策后的恢复日志，确认失败节点可重跑后再重试恢复。",
            )
        if run.status in {"需介入", "等待审核", "绛夊緟瀹℃牳"} or "人工审核" in text:
            return (
                "human_review_blocked",
                "等待人工审核",
                "进入人工审核页确认任务归属、SLA 和审核资格，完成通过、驳回或退回重跑决策。",
            )
        if any(keyword in text for keyword in ["鉴权", "auth", "401", "403", "凭证", "超时", "timeout"]) and any(
            keyword in text for keyword in ["连接器", "connector", "工具", "tool", "api"]
        ):
            return (
                "connector_auth_timeout",
                "连接器鉴权超时",
                "检查连接器凭证、权限范围和上游接口响应时间，必要时刷新授权后重跑失败节点。",
            )
        if any(keyword in text for keyword in ["模型", "model", "llm", "provider", "deepseek", "openai"]):
            return (
                "model_call_failed",
                "模型调用失败",
                "检查模型供应商配置、模型名称、限流和请求上下文；确认后重跑失败节点。",
            )
        if any(keyword in text for keyword in ["质量门", "质量门禁", "quality gate", "score", "rubric"]):
            return (
                "quality_gate_failed",
                "质量门禁未通过",
                "查看评分维度、门禁阈值和产出物证据，必要时修订产出后提交人工审核。",
            )
        if run.status in {"失败", "澶辫触"}:
            return (
                "unknown",
                "未知异常",
                "查看失败节点错误、审计事件和输入输出上下文，补充明确错误原因后再重跑。",
            )
        return (
            "normal",
            "无异常",
            "本次运行暂无阻塞原因，可继续查看产出物、节点耗时和成本信号。",
        )

    def observability_summary(run: WorkflowRunRecord) -> ObservabilityRunSummaryRead:
        failure_category, failure_category_label, troubleshooting_hint = observability_failure_classification(run)
        return ObservabilityRunSummaryRead(
            id=run.id,
            trace_id=run.trace_id or f"trace-{run.id}",
            workflow_name=run.name,
            status=run.status,
            current_node=run.current_node,
            started_at=run.started_at,
            completed_at=run.completed_at,
            duration_ms=run.duration_ms,
            score=run.score,
            cost_usd=round(float(run.cost_usd or 0), 6),
            prompt_tokens=run.prompt_tokens,
            completion_tokens=run.completion_tokens,
            priority=observability_priority(run)[1],
            next_action=observability_next_action(run),
            failure_category=failure_category,
            failure_category_label=failure_category_label,
            troubleshooting_hint=troubleshooting_hint,
        )

    def ensure_observability_trace_context(
        session: Session,
        run: WorkflowRunRecord,
        nodes: list[NodeRunRecord],
        human_tasks: list[HumanTaskRecord],
        audit_events: list[AuditEventRecord],
    ) -> None:
        if not run.trace_id:
            run.trace_id = f"trace-{run.id}"

        previous_span_id: str | None = None
        for node in nodes:
            if not node.trace_id:
                node.trace_id = run.trace_id
            if not node.span_id:
                node.span_id = f"span-{node.id}"
            if previous_span_id and not node.parent_span_id:
                node.parent_span_id = previous_span_id
            previous_span_id = node.span_id

        task_span_by_id = {
            task.id: node.span_id
            for task in human_tasks
            for node in nodes
            if task.node_run_id == node.id
        }
        for event in audit_events:
            if not event.trace_id:
                event.trace_id = run.trace_id
            if not event.span_id and event.human_task_id:
                event.span_id = task_span_by_id.get(event.human_task_id)

        session.commit()

    def observability_risk(run: WorkflowRunRecord) -> ObservabilityRiskRead | None:
        priority = observability_priority(run)[1]
        if priority == "normal":
            return None
        return ObservabilityRiskRead(
            run_id=run.id,
            title=run.name,
            severity=priority,
            message=f"{run.status} · {run.current_node or '未知节点'}",
            next_action=observability_next_action(run),
        )

    def observability_alert_event_type(run: WorkflowRunRecord, failure_category: str) -> str:
        if failure_category == "human_review_blocked":
            return "human_review_blocked"
        if failure_category == "resume_failed":
            return "resume_failed"
        if run.status in {"失败", "澶辫触"}:
            return "run_failure"
        return "run_attention"

    def observability_alerts(
        session: Session,
        workspace_id: str,
        sorted_runs: list[WorkflowRunRecord],
    ) -> list[ObservabilityAlertRead]:
        alerts: list[ObservabilityAlertRead] = []
        for run in sorted_runs:
            priority = observability_priority(run)[1]
            if priority == "normal":
                continue
            failure_category, failure_label, troubleshooting_hint = observability_failure_classification(run)
            alerts.append(ObservabilityAlertRead(
                id=f"alert-{run.id}-{failure_category}",
                event_key=f"run:{run.id}:{failure_category}",
                event_type=observability_alert_event_type(run, failure_category),
                severity=priority,
                channel="in_app",
                status="pending",
                title=run.name,
                message=f"{failure_label} · {run.error or run.current_node or '暂无错误详情'}",
                run_id=run.id,
                human_task_id=None,
                next_action=troubleshooting_hint,
                created_at=run.started_at,
            ))

        notifications = list(session.scalars(
            select(NotificationOutboxRecord)
            .where(NotificationOutboxRecord.workspace_id == workspace_id)
            .order_by(NotificationOutboxRecord.created_at.desc()),
        ))
        task_ids = {notification.human_task_id for notification in notifications}
        tasks_by_id = {
            task.id: task
            for task in session.scalars(
                select(HumanTaskRecord).where(HumanTaskRecord.id.in_(task_ids)),
            )
        } if task_ids else {}
        for notification in notifications:
            task = tasks_by_id.get(notification.human_task_id)
            run_id = task.workflow_run_id if task else None
            is_critical = notification.event_type == "escalated"
            alerts.append(ObservabilityAlertRead(
                id=f"notification-{notification.id}",
                event_key=notification.event_key,
                event_type=notification.event_type,
                severity="critical" if is_critical else "warning",
                channel="in_app",
                status=notification.status,
                title=task.title if task else "人工任务通知",
                message=f"{notification.event_type} · {notification.recipient_type}:{notification.recipient_id}",
                run_id=run_id,
                human_task_id=notification.human_task_id,
                next_action="进入人工审核页处理该通知",
                created_at=notification.created_at,
            ))
        return alerts[:20]

    def human_sla_severity(task: HumanTaskRecord) -> str | None:
        if task.status in {"恢复失败", "鎭㈠澶辫触"}:
            return "critical"
        if task.sla_status in {"已逾期", "已升级", "宸查€炬湡", "宸插崌绾?"}:
            return "critical"
        if task.sla_status in {"即将到期", "鍗冲皢鍒版湡"}:
            return "warning"
        return None

    def human_sla_priority(task: HumanTaskRecord) -> tuple[int, float]:
        severity = human_sla_severity(task)
        if task.status in {"恢复失败", "鎭㈠澶辫触"}:
            priority = 0
        elif task.sla_status in {"已逾期", "已升级", "宸查€炬湡", "宸插崌绾?"}:
            priority = 1
        elif severity == "warning":
            priority = 2
        else:
            priority = 3
        return priority, task.due_at.timestamp()

    def human_sla_risk(task: HumanTaskRecord) -> ObservabilityHumanSlaRiskRead | None:
        severity = human_sla_severity(task)
        if severity is None:
            return None
        return ObservabilityHumanSlaRiskRead(
            task_id=task.id,
            run_id=task.workflow_run_id,
            title=task.title,
            status=task.status,
            sla_status=task.sla_status,
            severity=severity,
            assignee_reviewer_id=task.assignee_reviewer_id,
            assignee_group_id=task.assignee_group_id,
            due_at=task.due_at,
            escalation_at=task.escalation_at,
            next_action="进入人工审核页处理该任务",
        )

    def cost_usage_group(name: str, runs: list[WorkflowRunRecord]) -> ObservabilityCostUsageGroupRead:
        scores = [run.score for run in runs if run.score is not None]
        return ObservabilityCostUsageGroupRead(
            name=name or "未记录",
            runs=len(runs),
            prompt_tokens=sum(run.prompt_tokens for run in runs),
            completion_tokens=sum(run.completion_tokens for run in runs),
            total_tokens=sum(run.prompt_tokens + run.completion_tokens for run in runs),
            cost_usd=round(sum(float(run.cost_usd or 0) for run in runs), 6),
            average_score=round(sum(scores) / len(scores)) if scores else None,
        )

    def grouped_cost_usage(
        runs: list[WorkflowRunRecord],
        key: Callable[[WorkflowRunRecord], str],
    ) -> list[ObservabilityCostUsageGroupRead]:
        groups: dict[str, list[WorkflowRunRecord]] = {}
        for run in runs:
            groups.setdefault(key(run), []).append(run)
        return sorted(
            [cost_usage_group(name, group_runs) for name, group_runs in groups.items()],
            key=lambda item: (-item.cost_usd, -item.total_tokens, item.name),
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

    @router.get("/observability/overview", response_model=ObservabilityOverviewRead)
    def observability_overview(
        request: Request,
        context_bundle: tuple[RequestContext, Session] = Depends(workspace_context),
    ) -> ObservabilityOverviewRead:
        context, session = context_bundle
        authorization_service.require_capability(
            session,
            context,
            "run.read",
            action="observability.overview",
            target_type="workspace",
            target_id=context.workspace.id,
            request=request,
        )
        runs = list(session.scalars(
            select(WorkflowRunRecord)
            .where(WorkflowRunRecord.workspace_id == context.workspace.id),
        ))
        durations = [run.duration_ms for run in runs if run.duration_ms]
        sorted_runs = sorted(
            runs,
            key=lambda run: (
                observability_priority(run)[0],
                -run.started_at.timestamp(),
            ),
        )
        risks = [
            risk
            for risk in (observability_risk(run) for run in sorted_runs)
            if risk is not None
        ]
        totals = ObservabilityTotalsRead(
            runs=len(runs),
            succeeded=sum(1 for run in runs if run.status in {"已完成", "宸插畬鎴?"}),
            failed=sum(1 for run in runs if run.status in {"失败", "澶辫触"}),
            waiting_for_human=sum(
                1
                for run in runs
                if run.status in {"需介入", "等待审核", "绛夊緟瀹℃牳"}
            ),
            resume_failed=sum(1 for run in runs if run.status == "恢复失败"),
            average_duration_ms=round(sum(durations) / len(durations)) if durations else None,
            total_prompt_tokens=sum(run.prompt_tokens for run in runs),
            total_completion_tokens=sum(run.completion_tokens for run in runs),
            total_cost_usd=round(sum(float(run.cost_usd or 0) for run in runs), 6),
        )
        return ObservabilityOverviewRead(
            totals=totals,
            risks=risks[:10],
            alerts=observability_alerts(session, context.workspace.id, sorted_runs),
            recent_runs=[observability_summary(run) for run in sorted_runs[:20]],
        )

    @router.get("/observability/human-sla", response_model=ObservabilityHumanSlaOverviewRead)
    def observability_human_sla(
        request: Request,
        reviewer_id: str | None = Query(default=None, alias="reviewerId"),
        group_id: str | None = Query(default=None, alias="groupId"),
        context_bundle: tuple[RequestContext, Session] = Depends(workspace_context),
    ) -> ObservabilityHumanSlaOverviewRead:
        context, session = context_bundle
        authorization_service.require_capability(
            session,
            context,
            "run.read",
            action="observability.human_sla.read",
            target_type="workspace",
            target_id=context.workspace.id,
            request=request,
        )
        tasks = human_task_service.list_tasks(
            session,
            context.workspace.id,
            reviewer_id=reviewer_id,
            group_id=group_id,
            active=True,
        )
        risks = [
            risk
            for risk in (
                human_sla_risk(task)
                for task in sorted(tasks, key=human_sla_priority)
            )
            if risk is not None
        ]
        reviewer_ids = {
            task.assignee_reviewer_id
            for task in tasks
            if task.assignee_reviewer_id
        }
        group_ids = {
            task.assignee_group_id
            for task in tasks
            if task.assignee_group_id
        }
        reviewers = list(session.scalars(
            select(ReviewerRecord)
            .where(
                ReviewerRecord.workspace_id == context.workspace.id,
                ReviewerRecord.id.in_(reviewer_ids),
            )
            .order_by(ReviewerRecord.name.asc()),
        )) if reviewer_ids else []
        groups = list(session.scalars(
            select(ReviewGroupRecord)
            .where(
                ReviewGroupRecord.workspace_id == context.workspace.id,
                ReviewGroupRecord.id.in_(group_ids),
            )
            .order_by(ReviewGroupRecord.name.asc()),
        )) if group_ids else []
        return ObservabilityHumanSlaOverviewRead(
            totals=ObservabilityHumanSlaTotalsRead(
                active_tasks=len(tasks),
                unclaimed=sum(1 for task in tasks if task.status in {"待认领", "寰呰棰?"}),
                in_review=sum(1 for task in tasks if task.status in {"审核中", "瀹℃牳涓?"}),
                due_soon=sum(1 for task in tasks if task.sla_status in {"即将到期", "鍗冲皢鍒版湡"}),
                overdue=sum(1 for task in tasks if task.sla_status in {"已逾期", "宸查€炬湡"}),
                escalated=sum(1 for task in tasks if task.sla_status in {"已升级", "宸插崌绾?"}),
                resume_failed=sum(1 for task in tasks if task.status in {"恢复失败", "鎭㈠澶辫触"}),
            ),
            risks=risks[:10],
            reviewers=[
                ObservabilityHumanSlaReviewerRead(id=reviewer.id, name=reviewer.name)
                for reviewer in reviewers
            ],
            groups=[
                ObservabilityHumanSlaGroupRead(id=group.id, name=group.name)
                for group in groups
            ],
        )

    @router.get("/observability/cost-usage", response_model=ObservabilityCostUsageRead)
    def observability_cost_usage(
        request: Request,
        context_bundle: tuple[RequestContext, Session] = Depends(workspace_context),
    ) -> ObservabilityCostUsageRead:
        context, session = context_bundle
        authorization_service.require_capability(
            session,
            context,
            "run.read",
            action="observability.cost_usage.read",
            target_type="workspace",
            target_id=context.workspace.id,
            request=request,
        )
        runs = list(session.scalars(
            select(WorkflowRunRecord)
            .where(WorkflowRunRecord.workspace_id == context.workspace.id),
        ))
        return ObservabilityCostUsageRead(
            cost_configured=(
                settings.model_input_usd_per_million_tokens > 0
                or settings.model_output_usd_per_million_tokens > 0
            ),
            totals=ObservabilityCostUsageTotalsRead(
                runs=len(runs),
                total_prompt_tokens=sum(run.prompt_tokens for run in runs),
                total_completion_tokens=sum(run.completion_tokens for run in runs),
                total_tokens=sum(run.prompt_tokens + run.completion_tokens for run in runs),
                total_cost_usd=round(sum(float(run.cost_usd or 0) for run in runs), 6),
            ),
            by_workflow=grouped_cost_usage(runs, lambda run: run.name),
            by_model=grouped_cost_usage(runs, lambda run: run.model),
        )

    @router.get("/observability/runs/{run_id}", response_model=ObservabilityRunDetailRead)
    def observability_run_detail(
        run_id: str,
        request: Request,
        context_bundle: tuple[RequestContext, Session] = Depends(workspace_context),
    ) -> ObservabilityRunDetailRead:
        context, session = context_bundle
        authorization_service.require_capability(
            session,
            context,
            "run.read",
            action="observability.run.read",
            target_type="run",
            target_id=run_id,
            request=request,
        )
        run = find_run(context.workspace.id, run_id, session)
        nodes = list(session.scalars(
            select(NodeRunRecord)
            .where(
                NodeRunRecord.workspace_id == context.workspace.id,
                NodeRunRecord.run_id == run.id,
            )
            .order_by(NodeRunRecord.started_at.asc()),
        ))
        human_tasks = list(session.scalars(
            select(HumanTaskRecord)
            .where(
                HumanTaskRecord.workspace_id == context.workspace.id,
                HumanTaskRecord.workflow_run_id == run.id,
            )
            .order_by(HumanTaskRecord.created_at.asc()),
        ))
        task_ids = [task.id for task in human_tasks]
        audit_events = list(session.scalars(
            select(AuditEventRecord)
            .where(
                AuditEventRecord.workspace_id == context.workspace.id,
                AuditEventRecord.human_task_id.in_(task_ids),
            )
            .order_by(AuditEventRecord.created_at.asc()),
        )) if task_ids else []
        ensure_observability_trace_context(
            session,
            run,
            nodes,
            human_tasks,
            audit_events,
        )
        summary = observability_summary(run)
        return ObservabilityRunDetailRead(
            **summary.model_dump(),
            nodes=[ObservabilityNodeRunRead.model_validate(node) for node in nodes],
            human_tasks=[
                ObservabilityHumanTaskRead.model_validate(task)
                for task in human_tasks
            ],
            audit_events=[
                ObservabilityAuditEventRead.model_validate(event)
                for event in audit_events
            ],
        )

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
                reviewer_id=payload.target_reviewer_id,
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

    @router.get("/evaluations/overview", response_model=EvaluationOverviewRead)
    def get_evaluations_overview(
        request: Request,
        context_bundle: tuple[RequestContext, Session] = Depends(workspace_context),
    ) -> dict:
        context, session = context_bundle
        authorization_service.require_capability(
            session,
            context,
            "asset.read",
            action="evaluation.overview",
            target_type="workspace",
            target_id=context.workspace.id,
            request=request,
        )
        candidate_count = session.scalar(
            select(func.count())
            .select_from(FeedbackCandidateRecord)
            .where(FeedbackCandidateRecord.workspace_id == context.workspace.id),
        ) or 0
        pending_count = session.scalar(
            select(func.count())
            .select_from(FeedbackCandidateRecord)
            .where(
                FeedbackCandidateRecord.workspace_id == context.workspace.id,
                FeedbackCandidateRecord.confirmed_at.is_(None),
            ),
        ) or 0
        confirmed_count = session.scalar(
            select(func.count())
            .select_from(FeedbackCandidateRecord)
            .where(
                FeedbackCandidateRecord.workspace_id == context.workspace.id,
                FeedbackCandidateRecord.confirmed_at.is_not(None),
            ),
        ) or 0
        golden_count = session.scalar(
            select(func.count())
            .select_from(GoldenSampleRecord)
            .where(GoldenSampleRecord.workspace_id == context.workspace.id),
        ) or 0
        workflow_count = session.scalar(
            select(func.count(func.distinct(FeedbackCandidateRecord.workflow_id)))
            .where(FeedbackCandidateRecord.workspace_id == context.workspace.id),
        ) or 0
        agent_count = session.scalar(
            select(func.count(func.distinct(FeedbackCandidateRecord.agent_id)))
            .where(FeedbackCandidateRecord.workspace_id == context.workspace.id),
        ) or 0
        recent_candidates = list(session.scalars(
            select(FeedbackCandidateRecord)
            .where(FeedbackCandidateRecord.workspace_id == context.workspace.id)
            .order_by(FeedbackCandidateRecord.created_at.desc())
            .limit(5),
        ))
        return {
            "totals": {
                "feedback_candidates": candidate_count,
                "pending_candidates": pending_count,
                "confirmed_candidates": confirmed_count,
                "golden_samples": golden_count,
                "covered_workflows": workflow_count,
                "covered_agents": agent_count,
            },
            "recent_candidates": [
                {
                    "id": candidate.id,
                    "reason": candidate.reason,
                    "tags": candidate.tags,
                    "workflow_id": candidate.workflow_id,
                    "agent_id": candidate.agent_id,
                    "source_node_id": candidate.source_node_id,
                    "created_by": candidate.created_by,
                    "status": "已确认" if candidate.confirmed_at is not None else "待确认",
                    "created_at": candidate.created_at,
                    "confirmed_at": candidate.confirmed_at,
                }
                for candidate in recent_candidates
            ],
        }

    def ensure_default_rubrics(session: Session, workspace_id: str) -> None:
        existing_count = session.scalar(
            select(func.count())
            .select_from(RubricRecord)
            .where(RubricRecord.workspace_id == workspace_id),
        ) or 0
        if existing_count > 0:
            return
        now = utc_now()
        for sort_order, rubric in enumerate(DEFAULT_RUBRICS, start=1):
            session.add(
                RubricRecord(
                    workspace_id=workspace_id,
                    sort_order=sort_order,
                    created_at=now,
                    updated_at=now,
                    **rubric,
                ),
            )
        session.flush()
        session.commit()

    @router.get("/evaluations/rubrics", response_model=list[RubricRead])
    def list_evaluation_rubrics(
        request: Request,
        context_bundle: tuple[RequestContext, Session] = Depends(workspace_context),
    ) -> list[RubricRecord]:
        context, session = context_bundle
        authorization_service.require_capability(
            session,
            context,
            "asset.read",
            action="evaluation.rubric.list",
            target_type="workspace",
            target_id=context.workspace.id,
            request=request,
        )
        ensure_default_rubrics(session, context.workspace.id)
        return list(session.scalars(
            select(RubricRecord)
            .where(RubricRecord.workspace_id == context.workspace.id)
            .order_by(RubricRecord.sort_order.asc(), RubricRecord.created_at.asc()),
        ))

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
