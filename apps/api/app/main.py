from collections.abc import Callable, Iterator
from datetime import datetime

from fastapi import APIRouter, Body, Depends, FastAPI, HTTPException, Query, Request, Response, status
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
from app.judge_gateway import JudgeGateway, ModelJudgeGateway
from app.migrations import ensure_current_schema
from app.model_gateway import ModelGateway, OpenAICompatibleGateway
from app.models import (
    AgentRecord,
    AgentVersionRecord,
    AuditEventRecord,
    Base,
    EvaluationRecord,
    ExecutionJobRecord,
    FeedbackCandidateRecord,
    GoldenSampleRecord,
    HumanReviewRecord,
    HumanTaskRecord,
    NodeRunRecord,
    NotificationOutboxRecord,
    RegressionRunRecord,
    RegressionSampleRecord,
    RegressionSampleSetRecord,
    RemediationTaskActivityRecord,
    RemediationTaskRecord,
    ReviewerRecord,
    ReviewGroupRecord,
    RubricRecord,
    RubricVersionRecord,
    ToolSkillAssetRecord,
    ToolSkillAssetInvocationRecord,
    WorkspaceRecord,
    WorkflowRecord,
    WorkflowRunRecord,
    WorkflowVersionRecord,
    utc_now,
)
from app.tool_runtime import HttpToolGateway, HttpxToolGateway, McpToolGateway, ToolRuntimeExecutor
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
    EvaluationRecordRead,
    EvaluationOverviewRead,
    EvaluationRunCreate,
    ExecutionJobDetailRead,
    ExecutionJobOperationRequest,
    ExecutionJobRead,
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
    ObservabilityExecutionEventRead,
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
    RegressionSampleCreate,
    RegressionSampleRead,
    RegressionRunCreate,
    RegressionRunRead,
    RegressionSampleSetCreate,
    RegressionSampleSetRead,
    RemediationTaskCreate,
    RemediationTaskActivityCreate,
    RemediationTaskActivityRead,
    RemediationTaskRead,
    RemediationTaskUpdate,
    ObservabilityTotalsRead,
    ReviewerRead,
    ReviewGroupRead,
    ReviewDecision,
    RubricRead,
    RubricVersionRead,
    RubricWrite,
    RunCreate,
    RunRead,
    ToolSkillAssetCreate,
    ToolSkillAssetInvocationRead,
    ToolSkillAssetRead,
    ToolSkillTestInvocationCreate,
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
    tool_gateway: HttpToolGateway | None = None,
    mcp_gateway: McpToolGateway | None = None,
    judge_gateway: JudgeGateway | None = None,
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
    resolved_model_gateway = model_gateway or OpenAICompatibleGateway(settings)
    resolved_judge_gateway = judge_gateway or ModelJudgeGateway(resolved_model_gateway)
    tool_runtime = ToolRuntimeExecutor(
        http_gateway=tool_gateway or HttpxToolGateway(settings),
        mcp_gateway=mcp_gateway,
    )
    execution_service = ExecutionService(
        resolved_model_gateway,
        settings,
        human_task_service,
        tool_runtime=tool_runtime,
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
    app.state.execution_service = execution_service
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

    def ensure_agent_assets_available(
        session: Session,
        *,
        workspace_id: str,
        tools: list[str],
        skills: list[str],
    ) -> None:
        for asset_type, names, label in (
            ("tool", tools, "Tool"),
            ("skill", skills, "Skill"),
        ):
            for name in names:
                asset = session.scalar(
                    select(ToolSkillAssetRecord).where(
                        ToolSkillAssetRecord.workspace_id == workspace_id,
                        ToolSkillAssetRecord.asset_type == asset_type,
                        ToolSkillAssetRecord.name == name,
                        ToolSkillAssetRecord.status == "active",
                    ),
                )
                if asset is None:
                    raise HTTPException(
                        status_code=422,
                        detail=f"未授权或不可用的 {label}：{name}",
                    )

    def agent_snapshot(record: AgentRecord) -> dict:
        return AgentRead.model_validate(record).model_dump(by_alias=True, mode="json")

    def find_rubric(workspace_id: str, rubric_id: str, session: Session) -> RubricRecord:
        rubric = session.scalar(
            select(RubricRecord).where(
                RubricRecord.id == rubric_id,
                RubricRecord.workspace_id == workspace_id,
            ),
        )
        if rubric is None:
            raise HTTPException(status_code=404, detail="评分量规不存在")
        return rubric

    def rubric_snapshot(record: RubricRecord) -> dict:
        return RubricRead.model_validate(record).model_dump(mode="json")

    def next_rubric_version(session: Session, workspace_id: str, rubric_id: str) -> str:
        count = session.scalar(
            select(func.count()).select_from(RubricVersionRecord).where(
                RubricVersionRecord.workspace_id == workspace_id,
                RubricVersionRecord.rubric_id == rubric_id,
            ),
        ) or 0
        return next_version(count)

    def latest_rubric_version(
        session: Session,
        workspace_id: str,
        rubric_id: str,
    ) -> RubricVersionRecord | None:
        return session.scalar(
            select(RubricVersionRecord)
            .where(
                RubricVersionRecord.workspace_id == workspace_id,
                RubricVersionRecord.rubric_id == rubric_id,
            )
            .order_by(RubricVersionRecord.created_at.desc()),
        )

    def active_rubric_snapshot(
        session: Session,
        workspace_id: str,
        rubric: RubricRecord,
    ) -> tuple[str, dict]:
        published = latest_rubric_version(session, workspace_id, rubric.id)
        if published is not None:
            return published.version, published.snapshot
        return rubric.version, rubric_snapshot(rubric)

    def deterministic_dimension_score(artifact_text: str) -> int:
        normalized = artifact_text.strip()
        if not normalized:
            return 0
        lower = normalized.lower()
        signal_keywords = (
            "source",
            "evidence",
            "owner",
            "risk",
            "next action",
            "acceptance",
            "criteria",
        )
        keyword_score = min(14, sum(2 for keyword in signal_keywords if keyword in lower))
        length_score = min(86, 42 + len(normalized) // 3)
        return min(100, length_score + keyword_score)

    def evaluate_with_rubric_snapshot(
        snapshot: dict,
        artifact_text: str,
        *,
        rubric_version: str,
        subject_type: str,
        subject_id: str | None,
    ) -> tuple[list[dict], int, str, str, str, str, dict]:
        judge_type = snapshot.get("judgeType", snapshot.get("judge_type", "deterministic"))
        if judge_type == "llm":
            judge_snapshot = {
                **snapshot,
                "passScore": snapshot.get("passScore", snapshot.get("pass_score")),
                "judgeType": "llm",
                "judgeModel": snapshot.get("judgeModel", snapshot.get("judge_model", "")),
            }
            try:
                result = resolved_judge_gateway.evaluate(
                    rubric_snapshot=judge_snapshot,
                    rubric_version=rubric_version,
                    artifact_text=artifact_text,
                    subject_type=subject_type,
                    subject_id=subject_id,
                )
            except RuntimeError as error:
                raise HTTPException(status_code=422, detail=str(error)) from None
            return (
                result.dimension_scores,
                result.score,
                result.status,
                result.rationale,
                "llm",
                result.model,
                result.input_snapshot,
            )
        dimension_base_score = deterministic_dimension_score(artifact_text)
        dimension_scores = [
            {
                "name": dimension["name"],
                "weight": dimension["weight"],
                "score": dimension_base_score,
            }
            for dimension in snapshot["dimensions"]
        ]
        weighted_score = round(
            sum(
                dimension["score"] * dimension["weight"]
                for dimension in dimension_scores
            ) / 100,
        )
        status_value = (
            "passed"
            if weighted_score >= snapshot["pass_score"]
            else "failed"
        )
        rationale = (
            "deterministic rubric evaluation: score is based on artifact "
            "length and explicit quality signals; LLM judge is not enabled yet."
        )
        return (
            dimension_scores,
            weighted_score,
            status_value,
            rationale,
            "deterministic",
            "",
            {
                "artifactText": artifact_text,
                "rubricVersion": rubric_version,
                "subjectType": subject_type,
                "subjectId": subject_id,
            },
        )

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

    def observability_execution_events(
        run: WorkflowRunRecord,
        nodes: list[NodeRunRecord],
        human_tasks: list[HumanTaskRecord],
        audit_events: list[AuditEventRecord],
        tool_invocations: list[ToolSkillAssetInvocationRecord],
    ) -> list[ObservabilityExecutionEventRead]:
        trace_id = run.trace_id or f"trace-{run.id}"
        events: list[ObservabilityExecutionEventRead] = [
            ObservabilityExecutionEventRead(
                id=f"run-{run.id}-started",
                type="run_started",
                title="运行开始",
                status=run.status,
                trace_id=trace_id,
                span_id=None,
                source_type="workflow_run",
                source_id=run.id,
                occurred_at=run.started_at,
                summary=f"{run.name} 开始执行",
            ),
        ]
        if run.completed_at is not None:
            events.append(ObservabilityExecutionEventRead(
                id=f"run-{run.id}-completed",
                type="run_completed",
                title="运行终态",
                status=run.status,
                trace_id=trace_id,
                span_id=None,
                source_type="workflow_run",
                source_id=run.id,
                occurred_at=run.completed_at,
                summary=f"{run.name} 进入 {run.status}",
            ))

        node_span_by_id = {node.id: node.span_id or f"span-{node.id}" for node in nodes}
        for node in nodes:
            events.append(ObservabilityExecutionEventRead(
                id=f"node-{node.id}",
                type="node_run",
                title=node.node_name,
                status=node.status,
                trace_id=node.trace_id or trace_id,
                span_id=node.span_id or f"span-{node.id}",
                source_type="node_run",
                source_id=node.id,
                occurred_at=node.started_at,
                summary=f"{node.node_type} 节点 {node.node_name}：{node.status}",
            ))

        for invocation in tool_invocations:
            events.append(ObservabilityExecutionEventRead(
                id=f"tool-invocation-{invocation.id}",
                type=f"tool_invocation_{invocation.status}",
                title=invocation.asset_name,
                status=invocation.status,
                trace_id=trace_id,
                span_id=node_span_by_id.get(invocation.node_run_id),
                source_type="tool_skill_invocation",
                source_id=invocation.id,
                occurred_at=invocation.created_at,
                summary=(
                    f"工具 {invocation.asset_name}：{invocation.status} · "
                    f"{invocation.output_summary or invocation.error}"
                ),
            ))

        for task in human_tasks:
            events.append(ObservabilityExecutionEventRead(
                id=f"human-task-{task.id}",
                type="human_task_created",
                title=task.title,
                status=task.status,
                trace_id=trace_id,
                span_id=node_span_by_id.get(task.node_run_id),
                source_type="human_task",
                source_id=task.id,
                occurred_at=task.created_at,
                summary=f"人工任务 {task.title}：{task.status}",
            ))

        for event in audit_events:
            event_type = event.event_type or event.action or "audit_event"
            events.append(ObservabilityExecutionEventRead(
                id=f"audit-{event.id}",
                type=event_type,
                title=event_type,
                status=event.outcome,
                trace_id=event.trace_id or trace_id,
                span_id=event.span_id,
                source_type="audit_event",
                source_id=event.id,
                occurred_at=event.created_at,
                summary=event.reason or event.action or event_type,
            ))

        source_order = {
            "workflow_run": 0,
            "node_run": 1,
            "tool_skill_invocation": 2,
            "human_task": 3,
            "audit_event": 4,
            "remediation_task": 5,
            "remediation_activity": 6,
            "regression_run": 7,
        }
        return sorted(
            events,
            key=lambda event: (
                event.occurred_at,
                source_order[event.source_type],
                event.id,
            ),
        )

    def remediation_execution_events(
        tasks: list[RemediationTaskRecord],
        activities_by_task_id: dict[str, list[RemediationTaskActivityRecord]],
        retest_runs_by_id: dict[str, RegressionRunRecord],
    ) -> list[ObservabilityExecutionEventRead]:
        events: list[ObservabilityExecutionEventRead] = []
        task_by_retest_run_id = {
            task.retest_run_id: task
            for task in tasks
            if task.retest_run_id
        }
        for task in tasks:
            trace_id = f"evaluation-{task.source_run_id}"
            events.append(ObservabilityExecutionEventRead(
                id=f"remediation-task-{task.id}",
                type="remediation_task_created",
                title=task.title,
                status=task.status,
                trace_id=trace_id,
                span_id=None,
                source_type="remediation_task",
                source_id=task.id,
                occurred_at=task.created_at,
                summary=f"修复任务 {task.title}：{task.status}",
            ))
            for activity in activities_by_task_id.get(task.id, []):
                events.append(ObservabilityExecutionEventRead(
                    id=f"remediation-activity-{activity.id}",
                    type=activity.kind,
                    title=activity.kind,
                    status=task.status,
                    trace_id=trace_id,
                    span_id=None,
                    source_type="remediation_activity",
                    source_id=activity.id,
                    occurred_at=activity.created_at,
                    summary=activity.body,
                ))

        for run_id, run in retest_runs_by_id.items():
            task = task_by_retest_run_id.get(run_id)
            trace_id = f"evaluation-{task.source_run_id}" if task else f"evaluation-{run.id}"
            events.append(ObservabilityExecutionEventRead(
                id=f"regression-run-{run.id}",
                type="remediation_retest_run",
                title=run.sample_set_name,
                status=run.status,
                trace_id=trace_id,
                span_id=None,
                source_type="regression_run",
                source_id=run.id,
                occurred_at=run.created_at,
                summary=f"复测 Run {run.id}：通过率 {run.pass_rate}%，失败 {run.failed_samples}",
            ))

        return sorted(
            events,
            key=lambda event: (event.occurred_at, event.source_type, event.id),
        )

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
        updates = payload.model_dump(exclude_unset=True)
        ensure_agent_assets_available(
            session,
            workspace_id=context.workspace.id,
            tools=updates.get("tools", record.tools),
            skills=updates.get("skills", record.skills),
        )
        for field, value in updates.items():
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
        ensure_agent_assets_available(
            session,
            workspace_id=context.workspace.id,
            tools=record.tools,
            skills=record.skills,
        )
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

    @router.get("/asset-library", response_model=list[ToolSkillAssetRead])
    def list_tool_skill_assets(
        request: Request,
        context_bundle: tuple[RequestContext, Session] = Depends(workspace_context),
    ) -> list[ToolSkillAssetRecord]:
        context, session = context_bundle
        authorization_service.require_capability(
            session,
            context,
            "asset.read",
            action="tool_skill_asset.list",
            target_type="workspace",
            target_id=context.workspace.id,
            request=request,
        )
        statement = (
            select(ToolSkillAssetRecord)
            .where(ToolSkillAssetRecord.workspace_id == context.workspace.id)
            .order_by(ToolSkillAssetRecord.created_at.desc())
        )
        return list(session.scalars(statement))

    @router.get(
        "/asset-library/invocations",
        response_model=list[ToolSkillAssetInvocationRead],
    )
    def list_tool_skill_asset_invocations(
        request: Request,
        asset_id: str | None = Query(default=None, alias="assetId"),
        agent_id: str | None = Query(default=None, alias="agentId"),
        invocation_status: str | None = Query(default=None, alias="status"),
        context_bundle: tuple[RequestContext, Session] = Depends(workspace_context),
    ) -> list[ToolSkillAssetInvocationRecord]:
        context, session = context_bundle
        authorization_service.require_capability(
            session,
            context,
            "asset.read",
            action="tool_skill_asset_invocation.list",
            target_type="workspace",
            target_id=context.workspace.id,
            request=request,
        )
        statement = select(ToolSkillAssetInvocationRecord).where(
            ToolSkillAssetInvocationRecord.workspace_id == context.workspace.id,
        )
        if asset_id:
            statement = statement.where(ToolSkillAssetInvocationRecord.asset_id == asset_id)
        if agent_id:
            statement = statement.where(ToolSkillAssetInvocationRecord.agent_id == agent_id)
        if invocation_status:
            statement = statement.where(ToolSkillAssetInvocationRecord.status == invocation_status)
        statement = statement.order_by(ToolSkillAssetInvocationRecord.created_at.desc())
        return list(session.scalars(statement))

    @router.post(
        "/asset-library",
        response_model=ToolSkillAssetRead,
        status_code=status.HTTP_201_CREATED,
    )
    def create_tool_skill_asset(
        payload: ToolSkillAssetCreate,
        request: Request,
        context_bundle: tuple[RequestContext, Session] = Depends(write_workspace_context),
    ) -> ToolSkillAssetRecord:
        context, session = context_bundle
        authorization_service.require_capability(
            session,
            context,
            "agent.write",
            action="tool_skill_asset.create",
            target_type="tool_skill_asset",
            target_id=None,
            request=request,
        )
        existing = session.scalar(
            select(ToolSkillAssetRecord).where(
                ToolSkillAssetRecord.workspace_id == context.workspace.id,
                ToolSkillAssetRecord.asset_type == payload.asset_type,
                ToolSkillAssetRecord.name == payload.name,
            ),
        )
        if existing is not None:
            raise HTTPException(status_code=409, detail="资产名称已存在")
        now = utc_now()
        record = ToolSkillAssetRecord(
            workspace_id=context.workspace.id,
            asset_type=payload.asset_type,
            name=payload.name,
            description=payload.description,
            parameter_schema=payload.parameter_schema,
            adapter_type=payload.adapter_type,
            adapter_config=payload.adapter_config,
            created_by=context.user.id,
            created_at=now,
            updated_at=now,
        )
        session.add(record)
        session.flush()
        record_success(
            session,
            context,
            action="tool_skill_asset.create",
            target_type="tool_skill_asset",
            target_id=record.id,
            request=request,
        )
        session.commit()
        session.refresh(record)
        return record

    @router.post(
        "/asset-library/{asset_id}/test-invocations",
        response_model=ToolSkillAssetInvocationRead,
        status_code=status.HTTP_201_CREATED,
    )
    def test_invoke_tool_skill_asset(
        asset_id: str,
        payload: ToolSkillTestInvocationCreate,
        request: Request,
        context_bundle: tuple[RequestContext, Session] = Depends(write_workspace_context),
    ) -> ToolSkillAssetInvocationRecord:
        context, session = context_bundle
        authorization_service.require_capability(
            session,
            context,
            "agent.write",
            action="tool_skill_asset.test_invoke",
            target_type="tool_skill_asset",
            target_id=asset_id,
            request=request,
        )
        asset = session.scalar(
            select(ToolSkillAssetRecord).where(
                ToolSkillAssetRecord.id == asset_id,
                ToolSkillAssetRecord.workspace_id == context.workspace.id,
            ),
        )
        if asset is None:
            raise HTTPException(status_code=404, detail="资产不存在")
        if asset.asset_type != "tool" or asset.adapter_type not in {"http", "mcp"}:
            raise HTTPException(status_code=422, detail="仅 HTTP / MCP Tool 支持测试调用")
        if asset.adapter_type == "http":
            runtime_result = tool_runtime.execute_http(
                config=asset.adapter_config,
                parameters=payload.parameters,
            )
        else:
            runtime_result = tool_runtime.execute_mcp(
                config=asset.adapter_config,
                parameters=payload.parameters,
            )
        record = ToolSkillAssetInvocationRecord(
            workspace_id=context.workspace.id,
            asset_id=asset.id,
            asset_type=asset.asset_type,
            asset_name=asset.name,
            agent_id=None,
            agent_version="",
            run_id=None,
            node_run_id=None,
            status=runtime_result.status,
            input_summary=runtime_result.input_summary,
            output_summary=runtime_result.output_summary,
            error=runtime_result.error,
            duration_ms=runtime_result.duration_ms,
            created_at=utc_now(),
        )
        session.add(record)
        session.flush()
        record_success(
            session,
            context,
            action="tool_skill_asset.test_invoke",
            target_type="tool_skill_asset",
            target_id=asset.id,
            request=request,
        )
        session.commit()
        session.refresh(record)
        return record

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
            if payload.async_mode:
                run = execution_service.enqueue_workflow_version(
                    session=session,
                    workflow_id=workflow_id,
                    workflow_version=version,
                    input_text=payload.input,
                    created_by=context.user.id,
                )
            else:
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

    @router.post("/execution-jobs/next", response_model=RunRead)
    def process_next_execution_job(
        request: Request,
        worker_id: str = Query("api-worker", alias="workerId", min_length=1, max_length=120),
        context_bundle: tuple[RequestContext, Session] = Depends(write_workspace_context),
    ) -> RunRead:
        context, session = context_bundle
        authorization_service.require_capability(
            session,
            context,
            "run.execute",
            action="execution_job.process_next",
            target_type="workspace",
            target_id=context.workspace.id,
            request=request,
        )
        run = execution_service.process_next_execution_job(
            session=session,
            workspace_id=context.workspace.id,
            worker_id=worker_id,
        )
        if run is None:
            raise HTTPException(status_code=404, detail="暂无待执行队列任务")
        return run_response(run, session)

    @router.get("/execution-jobs", response_model=list[ExecutionJobRead])
    def list_execution_jobs(
        request: Request,
        status_filter: str | None = Query(None, alias="status", max_length=32),
        context_bundle: tuple[RequestContext, Session] = Depends(workspace_context),
    ) -> list[ExecutionJobRead]:
        context, session = context_bundle
        authorization_service.require_capability(
            session,
            context,
            "run.read",
            action="execution_job.list",
            target_type="workspace",
            target_id=context.workspace.id,
            request=request,
        )
        statement = (
            select(ExecutionJobRecord)
            .where(ExecutionJobRecord.workspace_id == context.workspace.id)
            .order_by(ExecutionJobRecord.created_at.desc())
        )
        if status_filter:
            statement = statement.where(ExecutionJobRecord.status == status_filter)
        return [
            ExecutionJobRead.model_validate(job)
            for job in session.scalars(statement).all()
        ]

    @router.get("/execution-jobs/{job_id}", response_model=ExecutionJobDetailRead)
    def get_execution_job(
        job_id: str,
        request: Request,
        context_bundle: tuple[RequestContext, Session] = Depends(workspace_context),
    ) -> ExecutionJobDetailRead:
        context, session = context_bundle
        authorization_service.require_capability(
            session,
            context,
            "run.read",
            action="execution_job.read",
            target_type="execution_job",
            target_id=job_id,
            request=request,
        )
        job = session.scalar(
            select(ExecutionJobRecord).where(
                ExecutionJobRecord.id == job_id,
                ExecutionJobRecord.workspace_id == context.workspace.id,
            ),
        )
        if job is None:
            raise HTTPException(status_code=404, detail="队列任务不存在")
        audit_events = list(
            session.scalars(
                select(AuditEventRecord)
                .where(
                    AuditEventRecord.workspace_id == context.workspace.id,
                    AuditEventRecord.target_type == "execution_job",
                    AuditEventRecord.target_id == job_id,
                )
                .order_by(AuditEventRecord.created_at.asc(), AuditEventRecord.id.asc()),
            ),
        )
        payload = ExecutionJobRead.model_validate(job).model_dump(by_alias=False)
        return ExecutionJobDetailRead.model_validate({
            **payload,
            "audit_events": audit_events,
        })

    @router.post("/execution-jobs/{job_id}/heartbeat")
    def heartbeat_execution_job(
        job_id: str,
        request: Request,
        worker_id: str = Query(..., alias="workerId", min_length=1, max_length=120),
        context_bundle: tuple[RequestContext, Session] = Depends(write_workspace_context),
    ) -> dict[str, str]:
        context, session = context_bundle
        authorization_service.require_capability(
            session,
            context,
            "run.execute",
            action="execution_job.heartbeat",
            target_type="execution_job",
            target_id=job_id,
            request=request,
        )
        job = execution_service.heartbeat_execution_job(
            session=session,
            workspace_id=context.workspace.id,
            job_id=job_id,
            worker_id=worker_id,
        )
        if job is None:
            raise HTTPException(status_code=404, detail="队列任务不存在或租约不属于当前 worker")
        return {
            "id": job.id,
            "status": job.status,
            "lockedBy": job.locked_by,
            "lockedUntil": job.locked_until.isoformat() if job.locked_until else "",
        }

    @router.post("/execution-jobs/{job_id}/requeue", response_model=ExecutionJobRead)
    def requeue_execution_job(
        job_id: str,
        request: Request,
        operation: ExecutionJobOperationRequest | None = None,
        context_bundle: tuple[RequestContext, Session] = Depends(write_workspace_context),
    ) -> ExecutionJobRead:
        context, session = context_bundle
        authorization_service.require_capability(
            session,
            context,
            "run.execute",
            action="execution_job.requeue",
            target_type="execution_job",
            target_id=job_id,
            request=request,
        )
        before_job = session.scalar(
            select(ExecutionJobRecord).where(
                ExecutionJobRecord.id == job_id,
                ExecutionJobRecord.workspace_id == context.workspace.id,
            ),
        )
        before_status = before_job.status if before_job is not None else ""
        before_attempts = before_job.attempts if before_job is not None else 0
        job = execution_service.requeue_execution_job(
            session=session,
            workspace_id=context.workspace.id,
            job_id=job_id,
        )
        if job is None:
            raise HTTPException(status_code=404, detail="死信队列任务不存在")
        event = audit_service.record(
            session,
            actor=authorization_service.actor_from_context(context),
            action="execution_job.requeue",
            target_type="execution_job",
            target_id=job.id,
            outcome="success",
            request=request,
        )
        event.before_status = before_status
        event.after_status = job.status
        event.reason = operation.reason if operation else "手动重新入队"
        event.payload = {
            "runId": job.run_id,
            "workflowId": job.workflow_id,
            "attemptsBefore": before_attempts,
            "attemptsAfter": job.attempts,
        }
        session.commit()
        return ExecutionJobRead.model_validate(job)

    @router.post("/execution-jobs/{job_id}/cancel", response_model=ExecutionJobRead)
    def cancel_execution_job(
        job_id: str,
        request: Request,
        operation: ExecutionJobOperationRequest | None = None,
        context_bundle: tuple[RequestContext, Session] = Depends(write_workspace_context),
    ) -> ExecutionJobRead:
        context, session = context_bundle
        authorization_service.require_capability(
            session,
            context,
            "run.execute",
            action="execution_job.cancel",
            target_type="execution_job",
            target_id=job_id,
            request=request,
        )
        before_job = session.scalar(
            select(ExecutionJobRecord).where(
                ExecutionJobRecord.id == job_id,
                ExecutionJobRecord.workspace_id == context.workspace.id,
            ),
        )
        before_status = before_job.status if before_job is not None else ""
        before_attempts = before_job.attempts if before_job is not None else 0
        job = execution_service.cancel_execution_job(
            session=session,
            workspace_id=context.workspace.id,
            job_id=job_id,
        )
        if job is None:
            raise HTTPException(status_code=404, detail="可取消队列任务不存在")
        event = audit_service.record(
            session,
            actor=authorization_service.actor_from_context(context),
            action="execution_job.cancel",
            target_type="execution_job",
            target_id=job.id,
            outcome="success",
            request=request,
        )
        event.before_status = before_status
        event.after_status = job.status
        event.reason = operation.reason if operation else "用户取消执行"
        event.payload = {
            "runId": job.run_id,
            "workflowId": job.workflow_id,
            "attemptsBefore": before_attempts,
            "attemptsAfter": job.attempts,
        }
        session.commit()
        return ExecutionJobRead.model_validate(job)

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

    @router.get("/observability/execution-events", response_model=list[ObservabilityExecutionEventRead])
    def list_observability_execution_events(
        request: Request,
        run_id: str | None = Query(default=None, alias="runId"),
        trace_id: str | None = Query(default=None, alias="traceId"),
        context_bundle: tuple[RequestContext, Session] = Depends(workspace_context),
    ) -> list[ObservabilityExecutionEventRead]:
        context, session = context_bundle
        authorization_service.require_capability(
            session,
            context,
            "run.read",
            action="observability.execution_events.list",
            target_type="workspace",
            target_id=context.workspace.id,
            request=request,
        )
        run_statement = (
            select(WorkflowRunRecord)
            .where(WorkflowRunRecord.workspace_id == context.workspace.id)
            .order_by(WorkflowRunRecord.started_at.desc())
        )
        if run_id:
            run_statement = run_statement.where(WorkflowRunRecord.id == run_id)
        if trace_id:
            run_statement = run_statement.where(WorkflowRunRecord.trace_id == trace_id)
        runs = list(session.scalars(run_statement.limit(50)))
        events: list[ObservabilityExecutionEventRead] = []
        for run in runs:
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
            tool_invocations = list(session.scalars(
                select(ToolSkillAssetInvocationRecord)
                .where(
                    ToolSkillAssetInvocationRecord.workspace_id == context.workspace.id,
                    ToolSkillAssetInvocationRecord.run_id == run.id,
                )
                .order_by(ToolSkillAssetInvocationRecord.created_at.asc()),
            ))
            ensure_observability_trace_context(
                session,
                run,
                nodes,
                human_tasks,
                audit_events,
            )
            events.extend(observability_execution_events(
                run,
                nodes,
                human_tasks,
                audit_events,
                tool_invocations,
            ))

        if not run_id:
            remediation_tasks = list(session.scalars(
                select(RemediationTaskRecord)
                .where(RemediationTaskRecord.workspace_id == context.workspace.id)
                .order_by(RemediationTaskRecord.created_at.asc()),
            ))
            activities_by_task_id = list_remediation_task_activities(
                session,
                context.workspace.id,
                [task.id for task in remediation_tasks],
            )
            retest_run_ids = [
                task.retest_run_id
                for task in remediation_tasks
                if task.retest_run_id
            ]
            retest_runs = list(session.scalars(
                select(RegressionRunRecord)
                .where(
                    RegressionRunRecord.workspace_id == context.workspace.id,
                    RegressionRunRecord.id.in_(retest_run_ids),
                ),
            )) if retest_run_ids else []
            events.extend(remediation_execution_events(
                remediation_tasks,
                activities_by_task_id,
                {run.id: run for run in retest_runs},
            ))

        if trace_id:
            events = [event for event in events if event.trace_id == trace_id]
        return sorted(events, key=lambda event: (event.occurred_at, event.source_type, event.id))

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
        tool_invocations = list(session.scalars(
            select(ToolSkillAssetInvocationRecord)
            .where(
                ToolSkillAssetInvocationRecord.workspace_id == context.workspace.id,
                ToolSkillAssetInvocationRecord.run_id == run.id,
            )
            .order_by(ToolSkillAssetInvocationRecord.created_at.asc()),
        ))
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
            execution_events=observability_execution_events(
                run,
                nodes,
                human_tasks,
                audit_events,
                tool_invocations,
            ),
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

    def regression_sample_to_read(sample: RegressionSampleRecord) -> dict:
        return {
            "id": sample.id,
            "sample_set_id": sample.sample_set_id,
            "name": sample.name,
            "input_text": sample.input_text,
            "expected_output": sample.expected_output,
            "tags": sample.tags,
            "source_type": sample.source_type,
            "source_id": sample.source_id,
            "status": sample.status,
            "created_by": sample.created_by,
            "created_at": sample.created_at,
            "updated_at": sample.updated_at,
        }

    def regression_sample_set_to_read(
        sample_set: RegressionSampleSetRecord,
        samples: list[RegressionSampleRecord],
    ) -> dict:
        return {
            "id": sample_set.id,
            "name": sample_set.name,
            "description": sample_set.description,
            "status": sample_set.status,
            "sample_count": len(samples),
            "active_sample_count": len([
                sample for sample in samples if sample.status == "active"
            ]),
            "samples": [regression_sample_to_read(sample) for sample in samples],
            "created_by": sample_set.created_by,
            "created_at": sample_set.created_at,
            "updated_at": sample_set.updated_at,
        }

    def find_regression_sample_set(
        workspace_id: str,
        sample_set_id: str,
        session: Session,
    ) -> RegressionSampleSetRecord:
        record = session.scalar(
            select(RegressionSampleSetRecord).where(
                RegressionSampleSetRecord.id == sample_set_id,
                RegressionSampleSetRecord.workspace_id == workspace_id,
            ),
        )
        if record is None:
            raise HTTPException(status_code=404, detail="sample set not found")
        return record

    def regression_run_to_read(
        run: RegressionRunRecord,
        records: list[EvaluationRecord] | None = None,
    ) -> dict:
        return {
            "id": run.id,
            "sample_set_id": run.sample_set_id,
            "sample_set_name": run.sample_set_name,
            "rubric_id": run.rubric_id,
            "rubric_name": run.rubric_name,
            "rubric_version": run.rubric_version,
            "status": run.status,
            "total_samples": run.total_samples,
            "passed_samples": run.passed_samples,
            "failed_samples": run.failed_samples,
            "pass_rate": run.pass_rate,
            "evaluation_ids": run.evaluation_ids,
            "records": records or [],
            "created_by": run.created_by,
            "created_at": run.created_at,
            "completed_at": run.completed_at,
        }

    def remediation_task_to_read(
        task: RemediationTaskRecord,
        retest_run: dict | None = None,
        activities: list[RemediationTaskActivityRecord] | None = None,
    ) -> dict:
        return {
            "id": task.id,
            "source_run_id": task.source_run_id,
            "cluster_key": task.cluster_key,
            "title": task.title,
            "priority": task.priority,
            "sample_ids": task.sample_ids,
            "action": task.action,
            "status": task.status,
            "owner": task.owner,
            "due_date": task.due_date,
            "is_overdue": is_remediation_task_overdue(task),
            "retest_run_id": task.retest_run_id,
            "retest_run": retest_run,
            "activities": [
                remediation_task_activity_to_read(activity)
                for activity in (activities or [])
            ],
            "created_by": task.created_by,
            "updated_by": task.updated_by,
            "created_at": task.created_at,
            "updated_at": task.updated_at,
        }

    def remediation_task_activity_to_read(activity: RemediationTaskActivityRecord) -> dict:
        return {
            "id": activity.id,
            "task_id": activity.task_id,
            "kind": activity.kind,
            "body": activity.body,
            "attachment_refs": activity.attachment_refs,
            "actor_user_id": activity.actor_user_id,
            "actor_display_name": activity.actor_display_name,
            "created_at": activity.created_at,
        }

    def list_remediation_task_activities(
        session: Session,
        workspace_id: str,
        task_ids: list[str],
    ) -> dict[str, list[RemediationTaskActivityRecord]]:
        if not task_ids:
            return {}
        activities = list(session.scalars(
            select(RemediationTaskActivityRecord)
            .where(
                RemediationTaskActivityRecord.workspace_id == workspace_id,
                RemediationTaskActivityRecord.task_id.in_(task_ids),
            )
            .order_by(RemediationTaskActivityRecord.created_at.asc()),
        ))
        grouped: dict[str, list[RemediationTaskActivityRecord]] = {}
        for activity in activities:
            grouped.setdefault(activity.task_id, []).append(activity)
        return grouped

    def create_remediation_task_activity(
        *,
        session: Session,
        context: RequestContext,
        task_id: str,
        kind: str,
        body: str,
        attachment_refs: list[str] | None = None,
    ) -> RemediationTaskActivityRecord:
        activity = RemediationTaskActivityRecord(
            workspace_id=context.workspace.id,
            task_id=task_id,
            kind=kind,
            body=body,
            attachment_refs=attachment_refs or [],
            actor_user_id=context.user.id,
            actor_display_name=context.user.display_name,
            created_at=utc_now(),
        )
        session.add(activity)
        session.flush()
        return activity

    def is_remediation_task_overdue(task: RemediationTaskRecord) -> bool:
        if task.status == "done" or task.due_date is None:
            return False
        now = utc_now()
        due_date = task.due_date
        if due_date.tzinfo is None:
            return due_date < now.replace(tzinfo=None)
        return due_date < now

    def get_retest_run_read(
        session: Session,
        workspace_id: str,
        task: RemediationTaskRecord,
    ) -> dict | None:
        if not task.retest_run_id:
            return None
        retest_run = session.scalar(
            select(RegressionRunRecord).where(
                RegressionRunRecord.workspace_id == workspace_id,
                RegressionRunRecord.id == task.retest_run_id,
            ),
        )
        if retest_run is None:
            return None
        if not retest_run.evaluation_ids:
            return regression_run_to_read(retest_run, [])
        records = list(session.scalars(
            select(EvaluationRecord).where(
                EvaluationRecord.workspace_id == workspace_id,
                EvaluationRecord.id.in_(retest_run.evaluation_ids),
            ),
        ))
        records_by_id = {record.id: record for record in records}
        ordered_records = [
            records_by_id[evaluation_id]
            for evaluation_id in retest_run.evaluation_ids
            if evaluation_id in records_by_id
        ]
        return regression_run_to_read(retest_run, ordered_records)

    def create_regression_run_from_samples(
        *,
        session: Session,
        context: RequestContext,
        rubric: RubricRecord,
        rubric_version: str,
        snapshot: dict,
        sample_set_id: str | None,
        sample_set_name: str,
        batch_samples: list[dict[str, str]],
    ) -> tuple[RegressionRunRecord, list[EvaluationRecord]]:
        records: list[EvaluationRecord] = []
        for sample in batch_samples:
            (
                dimension_scores,
                score,
                status_value,
                rationale,
                evaluator_type,
                evaluator_model,
                evaluator_input,
            ) = evaluate_with_rubric_snapshot(
                snapshot,
                sample["input"],
                rubric_version=rubric_version,
                subject_type="regression_run_sample",
                subject_id=sample["id"],
            )
            record = EvaluationRecord(
                workspace_id=context.workspace.id,
                rubric_id=rubric.id,
                rubric_version=rubric_version,
                rubric_snapshot=snapshot,
                subject_type="regression_run_sample",
                subject_id=sample["id"],
                artifact_text=sample["input"],
                dimension_scores=dimension_scores,
                score=score,
                status=status_value,
                rationale=rationale,
                evaluator_type=evaluator_type,
                evaluator_model=evaluator_model,
                evaluator_input=evaluator_input,
                created_by=context.user.id,
            )
            session.add(record)
            records.append(record)
        session.flush()
        total_samples = len(records)
        passed_samples = len([record for record in records if record.status == "passed"])
        failed_samples = total_samples - passed_samples
        pass_rate = round((passed_samples / total_samples) * 100)
        now = utc_now()
        run = RegressionRunRecord(
            workspace_id=context.workspace.id,
            sample_set_id=sample_set_id,
            sample_set_name=sample_set_name,
            rubric_id=rubric.id,
            rubric_name=rubric.name,
            rubric_version=rubric_version,
            status="completed",
            total_samples=total_samples,
            passed_samples=passed_samples,
            failed_samples=failed_samples,
            pass_rate=pass_rate,
            evaluation_ids=[record.id for record in records],
            created_by=context.user.id,
            created_at=now,
            completed_at=now,
        )
        session.add(run)
        session.flush()
        return run, records

    @router.get(
        "/evaluations/sample-sets",
        response_model=list[RegressionSampleSetRead],
    )
    def list_regression_sample_sets(
        request: Request,
        context_bundle: tuple[RequestContext, Session] = Depends(workspace_context),
    ) -> list[dict]:
        context, session = context_bundle
        authorization_service.require_capability(
            session,
            context,
            "asset.read",
            action="evaluation.sample_set.list",
            target_type="workspace",
            target_id=context.workspace.id,
            request=request,
        )
        sample_sets = list(session.scalars(
            select(RegressionSampleSetRecord)
            .where(RegressionSampleSetRecord.workspace_id == context.workspace.id)
            .order_by(RegressionSampleSetRecord.created_at.desc()),
        ))
        samples = list(session.scalars(
            select(RegressionSampleRecord)
            .where(RegressionSampleRecord.workspace_id == context.workspace.id)
            .order_by(RegressionSampleRecord.created_at.asc()),
        ))
        samples_by_set: dict[str, list[RegressionSampleRecord]] = {
            sample_set.id: [] for sample_set in sample_sets
        }
        for sample in samples:
            samples_by_set.setdefault(sample.sample_set_id, []).append(sample)
        return [
            regression_sample_set_to_read(sample_set, samples_by_set.get(sample_set.id, []))
            for sample_set in sample_sets
        ]

    @router.post(
        "/evaluations/sample-sets",
        response_model=RegressionSampleSetRead,
        status_code=status.HTTP_201_CREATED,
    )
    def create_regression_sample_set(
        payload: RegressionSampleSetCreate,
        request: Request,
        context_bundle: tuple[RequestContext, Session] = Depends(write_workspace_context),
    ) -> dict:
        context, session = context_bundle
        authorization_service.require_capability(
            session,
            context,
            "rubric.write",
            action="evaluation.sample_set.create",
            target_type="evaluation_sample_set",
            target_id=None,
            request=request,
        )
        duplicate = session.scalar(
            select(RegressionSampleSetRecord).where(
                RegressionSampleSetRecord.workspace_id == context.workspace.id,
                RegressionSampleSetRecord.name == payload.name,
            ),
        )
        if duplicate is not None:
            raise HTTPException(status_code=409, detail="sample set name already exists")
        now = utc_now()
        record = RegressionSampleSetRecord(
            workspace_id=context.workspace.id,
            name=payload.name,
            description=payload.description,
            status="active",
            created_by=context.user.id,
            created_at=now,
            updated_at=now,
        )
        session.add(record)
        session.flush()
        record_success(
            session,
            context,
            action="evaluation.sample_set.create",
            target_type="evaluation_sample_set",
            target_id=record.id,
            request=request,
        )
        session.commit()
        session.refresh(record)
        return regression_sample_set_to_read(record, [])

    @router.post(
        "/evaluations/sample-sets/{sample_set_id}/samples",
        response_model=RegressionSampleRead,
        status_code=status.HTTP_201_CREATED,
    )
    def create_regression_sample(
        sample_set_id: str,
        payload: RegressionSampleCreate,
        request: Request,
        context_bundle: tuple[RequestContext, Session] = Depends(write_workspace_context),
    ) -> dict:
        context, session = context_bundle
        authorization_service.require_capability(
            session,
            context,
            "rubric.write",
            action="evaluation.sample.create",
            target_type="evaluation_sample_set",
            target_id=sample_set_id,
            request=request,
        )
        sample_set = find_regression_sample_set(
            context.workspace.id,
            sample_set_id,
            session,
        )
        if sample_set.status != "active":
            raise HTTPException(status_code=409, detail="sample set is not active")
        now = utc_now()
        record = RegressionSampleRecord(
            workspace_id=context.workspace.id,
            sample_set_id=sample_set.id,
            name=payload.name,
            input_text=payload.input_text,
            expected_output=payload.expected_output,
            tags=payload.tags,
            source_type="manual",
            source_id=None,
            status="active",
            created_by=context.user.id,
            created_at=now,
            updated_at=now,
        )
        sample_set.updated_at = now
        session.add(record)
        session.flush()
        record_success(
            session,
            context,
            action="evaluation.sample.create",
            target_type="evaluation_sample",
            target_id=record.id,
            request=request,
        )
        session.commit()
        session.refresh(record)
        return regression_sample_to_read(record)

    @router.get(
        "/evaluations/remediation-tasks",
        response_model=list[RemediationTaskRead],
    )
    def list_remediation_tasks(
        request: Request,
        owner: str | None = Query(default=None, max_length=120),
        priority: str | None = Query(default=None, pattern="^P[0-2]$"),
        overdue: bool | None = Query(default=None),
        context_bundle: tuple[RequestContext, Session] = Depends(workspace_context),
    ) -> list[dict]:
        context, session = context_bundle
        authorization_service.require_capability(
            session,
            context,
            "asset.read",
            action="evaluation.remediation_task.list",
            target_type="workspace",
            target_id=context.workspace.id,
            request=request,
        )
        statement = select(RemediationTaskRecord).where(
            RemediationTaskRecord.workspace_id == context.workspace.id,
        )
        if owner:
            statement = statement.where(RemediationTaskRecord.owner == owner.strip())
        if priority:
            statement = statement.where(RemediationTaskRecord.priority == priority)
        tasks = list(session.scalars(
            statement.order_by(RemediationTaskRecord.created_at.desc()),
        ))
        if overdue is not None:
            tasks = [task for task in tasks if is_remediation_task_overdue(task) is overdue]
        activities_by_task_id = list_remediation_task_activities(
            session,
            context.workspace.id,
            [task.id for task in tasks],
        )
        return [
            remediation_task_to_read(
                task,
                retest_run=get_retest_run_read(session, context.workspace.id, task),
                activities=activities_by_task_id.get(task.id, []),
            )
            for task in tasks
        ]

    @router.post(
        "/evaluations/remediation-tasks",
        response_model=RemediationTaskRead,
        status_code=status.HTTP_201_CREATED,
    )
    def create_remediation_task(
        payload: RemediationTaskCreate,
        request: Request,
        response: Response,
        context_bundle: tuple[RequestContext, Session] = Depends(write_workspace_context),
    ) -> dict:
        context, session = context_bundle
        authorization_service.require_capability(
            session,
            context,
            "evaluation.run",
            action="evaluation.remediation_task.create",
            target_type="regression_run",
            target_id=payload.source_run_id,
            request=request,
        )
        existing = session.scalar(
            select(RemediationTaskRecord).where(
                RemediationTaskRecord.workspace_id == context.workspace.id,
                RemediationTaskRecord.source_run_id == payload.source_run_id,
                RemediationTaskRecord.cluster_key == payload.cluster_key,
            ),
        )
        if existing is not None:
            response.status_code = status.HTTP_200_OK
            return remediation_task_to_read(existing)
        now = utc_now()
        task = RemediationTaskRecord(
            workspace_id=context.workspace.id,
            source_run_id=payload.source_run_id,
            cluster_key=payload.cluster_key,
            title=payload.title,
            priority=payload.priority,
            sample_ids=payload.sample_ids,
            action=payload.action,
            status="open",
            owner=payload.owner or context.user.display_name,
            due_date=payload.due_date,
            created_by=context.user.id,
            updated_by=context.user.id,
            created_at=now,
            updated_at=now,
        )
        session.add(task)
        session.flush()
        record_success(
            session,
            context,
            action="evaluation.remediation_task.create",
            target_type="remediation_task",
            target_id=task.id,
            request=request,
        )
        session.commit()
        session.refresh(task)
        return remediation_task_to_read(task)

    @router.post(
        "/evaluations/remediation-tasks/{task_id}/activities",
        response_model=RemediationTaskActivityRead,
        status_code=status.HTTP_201_CREATED,
    )
    def create_remediation_task_comment(
        task_id: str,
        payload: RemediationTaskActivityCreate,
        request: Request,
        context_bundle: tuple[RequestContext, Session] = Depends(write_workspace_context),
    ) -> dict:
        context, session = context_bundle
        authorization_service.require_capability(
            session,
            context,
            "evaluation.run",
            action="evaluation.remediation_task.comment",
            target_type="remediation_task",
            target_id=task_id,
            request=request,
        )
        task = session.scalar(
            select(RemediationTaskRecord).where(
                RemediationTaskRecord.workspace_id == context.workspace.id,
                RemediationTaskRecord.id == task_id,
            ),
        )
        if task is None:
            raise HTTPException(status_code=404, detail="remediation task not found")
        activity = create_remediation_task_activity(
            session=session,
            context=context,
            task_id=task.id,
            kind="comment",
            body=payload.body,
            attachment_refs=payload.attachment_refs,
        )
        task.updated_by = context.user.id
        task.updated_at = utc_now()
        record_success(
            session,
            context,
            action="evaluation.remediation_task.comment",
            target_type="remediation_task",
            target_id=task.id,
            request=request,
        )
        session.commit()
        session.refresh(activity)
        return remediation_task_activity_to_read(activity)

    @router.patch(
        "/evaluations/remediation-tasks/{task_id}",
        response_model=RemediationTaskRead,
    )
    def update_remediation_task(
        task_id: str,
        payload: RemediationTaskUpdate,
        request: Request,
        context_bundle: tuple[RequestContext, Session] = Depends(write_workspace_context),
    ) -> dict:
        context, session = context_bundle
        authorization_service.require_capability(
            session,
            context,
            "evaluation.run",
            action="evaluation.remediation_task.update",
            target_type="remediation_task",
            target_id=task_id,
            request=request,
        )
        task = session.scalar(
            select(RemediationTaskRecord).where(
                RemediationTaskRecord.workspace_id == context.workspace.id,
                RemediationTaskRecord.id == task_id,
            ),
        )
        if task is None:
            raise HTTPException(status_code=404, detail="remediation task not found")
        previous_status = task.status
        task.status = payload.status
        if previous_status != "done" and payload.status == "done" and task.retest_run_id:
            task.retest_run_id = None
        task.updated_by = context.user.id
        task.updated_at = utc_now()
        if previous_status != payload.status:
            create_remediation_task_activity(
                session=session,
                context=context,
                task_id=task.id,
                kind="status_change",
                body=f"状态变更：{previous_status} -> {payload.status}",
            )
        record_success(
            session,
            context,
            action="evaluation.remediation_task.update",
            target_type="remediation_task",
            target_id=task.id,
            request=request,
        )
        session.commit()
        session.refresh(task)
        activities = list_remediation_task_activities(session, context.workspace.id, [task.id])
        return remediation_task_to_read(task, activities=activities.get(task.id, []))

    @router.post(
        "/evaluations/remediation-tasks/{task_id}/retest",
        response_model=RemediationTaskRead,
        status_code=status.HTTP_201_CREATED,
    )
    def retest_remediation_task(
        task_id: str,
        request: Request,
        response: Response,
        context_bundle: tuple[RequestContext, Session] = Depends(write_workspace_context),
    ) -> dict:
        context, session = context_bundle
        authorization_service.require_capability(
            session,
            context,
            "evaluation.run",
            action="evaluation.remediation_task.retest",
            target_type="remediation_task",
            target_id=task_id,
            request=request,
        )
        task = session.scalar(
            select(RemediationTaskRecord).where(
                RemediationTaskRecord.workspace_id == context.workspace.id,
                RemediationTaskRecord.id == task_id,
            ),
        )
        if task is None:
            raise HTTPException(status_code=404, detail="remediation task not found")
        if task.status != "done":
            raise HTTPException(status_code=409, detail="remediation task must be done before retest")
        existing_retest = get_retest_run_read(session, context.workspace.id, task)
        if existing_retest is not None:
            response.status_code = status.HTTP_200_OK
            activities = list_remediation_task_activities(session, context.workspace.id, [task.id])
            return remediation_task_to_read(
                task,
                existing_retest,
                activities=activities.get(task.id, []),
            )
        source_run = session.scalar(
            select(RegressionRunRecord).where(
                RegressionRunRecord.workspace_id == context.workspace.id,
                RegressionRunRecord.id == task.source_run_id,
            ),
        )
        if source_run is None:
            raise HTTPException(status_code=422, detail="source regression run not found")
        if not source_run.evaluation_ids:
            raise HTTPException(status_code=422, detail="source regression run has no evaluations")
        source_records = list(session.scalars(
            select(EvaluationRecord).where(
                EvaluationRecord.workspace_id == context.workspace.id,
                EvaluationRecord.id.in_(source_run.evaluation_ids),
            ),
        ))
        records_by_subject = {
            record.subject_id: record
            for record in source_records
            if record.subject_id is not None
        }
        batch_samples = [
            {
                "id": sample_id,
                "input": records_by_subject[sample_id].artifact_text,
            }
            for sample_id in task.sample_ids
            if sample_id in records_by_subject
        ]
        if len(batch_samples) == 0:
            raise HTTPException(status_code=422, detail="no source samples found for retest")
        rubric = find_rubric(context.workspace.id, source_run.rubric_id, session)
        if rubric.status != "active":
            raise HTTPException(status_code=409, detail="只有已启用评分量规可以运行回归")
        rubric_version, snapshot = active_rubric_snapshot(
            session,
            context.workspace.id,
            rubric,
        )
        retest_run, records = create_regression_run_from_samples(
            session=session,
            context=context,
            rubric=rubric,
            rubric_version=rubric_version,
            snapshot=snapshot,
            sample_set_id=None,
            sample_set_name="修复复测",
            batch_samples=batch_samples,
        )
        task.retest_run_id = retest_run.id
        if retest_run.failed_samples > 0:
            previous_status = task.status
            task.status = "in_progress"
            create_remediation_task_activity(
                session=session,
                context=context,
                task_id=task.id,
                kind="retest_failed",
                body=f"复测未通过：{retest_run.failed_samples} 条样本失败，任务已回流",
            )
            if previous_status != task.status:
                create_remediation_task_activity(
                    session=session,
                    context=context,
                    task_id=task.id,
                    kind="status_change",
                    body=f"状态变更：{previous_status} -> {task.status}",
                )
        else:
            create_remediation_task_activity(
                session=session,
                context=context,
                task_id=task.id,
                kind="retest_passed",
                body="复测通过：0 条样本失败",
            )
        task.updated_by = context.user.id
        task.updated_at = utc_now()
        record_success(
            session,
            context,
            action="evaluation.remediation_task.retest",
            target_type="remediation_task",
            target_id=task.id,
            request=request,
        )
        session.commit()
        session.refresh(task)
        session.refresh(retest_run)
        for record in records:
            session.refresh(record)
        activities = list_remediation_task_activities(session, context.workspace.id, [task.id])
        return remediation_task_to_read(
            task,
            regression_run_to_read(retest_run, records),
            activities=activities.get(task.id, []),
        )

    @router.get(
        "/evaluations/regression-runs",
        response_model=list[RegressionRunRead],
    )
    def list_regression_runs(
        request: Request,
        context_bundle: tuple[RequestContext, Session] = Depends(workspace_context),
    ) -> list[dict]:
        context, session = context_bundle
        authorization_service.require_capability(
            session,
            context,
            "asset.read",
            action="evaluation.regression_run.list",
            target_type="workspace",
            target_id=context.workspace.id,
            request=request,
        )
        runs = list(session.scalars(
            select(RegressionRunRecord)
            .where(RegressionRunRecord.workspace_id == context.workspace.id)
            .order_by(RegressionRunRecord.created_at.desc()),
        ))
        return [regression_run_to_read(run) for run in runs]

    @router.get(
        "/evaluations/regression-runs/{run_id}",
        response_model=RegressionRunRead,
    )
    def get_regression_run(
        run_id: str,
        request: Request,
        context_bundle: tuple[RequestContext, Session] = Depends(workspace_context),
    ) -> dict:
        context, session = context_bundle
        authorization_service.require_capability(
            session,
            context,
            "asset.read",
            action="evaluation.regression_run.detail",
            target_type="regression_run",
            target_id=run_id,
            request=request,
        )
        run = session.scalar(
            select(RegressionRunRecord).where(
                RegressionRunRecord.workspace_id == context.workspace.id,
                RegressionRunRecord.id == run_id,
            ),
        )
        if run is None:
            raise HTTPException(status_code=404, detail="regression run not found")
        if not run.evaluation_ids:
            return regression_run_to_read(run, [])
        records = list(session.scalars(
            select(EvaluationRecord).where(
                EvaluationRecord.workspace_id == context.workspace.id,
                EvaluationRecord.id.in_(run.evaluation_ids),
            ),
        ))
        records_by_id = {record.id: record for record in records}
        ordered_records = [
            records_by_id[evaluation_id]
            for evaluation_id in run.evaluation_ids
            if evaluation_id in records_by_id
        ]
        return regression_run_to_read(run, ordered_records)

    @router.post(
        "/evaluations/regression-runs",
        response_model=RegressionRunRead,
        status_code=status.HTTP_201_CREATED,
    )
    def create_regression_run(
        payload: RegressionRunCreate,
        request: Request,
        context_bundle: tuple[RequestContext, Session] = Depends(write_workspace_context),
    ) -> dict:
        context, session = context_bundle
        authorization_service.require_capability(
            session,
            context,
            "evaluation.run",
            action="evaluation.regression_run.create",
            target_type="rubric",
            target_id=payload.rubric_id,
            request=request,
        )
        rubric = find_rubric(context.workspace.id, payload.rubric_id, session)
        if rubric.status != "active":
            raise HTTPException(status_code=409, detail="只有已启用评分量规可以运行回归")
        rubric_version, snapshot = active_rubric_snapshot(
            session,
            context.workspace.id,
            rubric,
        )
        sample_set_id: str | None = None
        sample_set_name = "手动样本"
        batch_samples: list[dict[str, str]] = []
        if payload.sample_set_id is not None:
            sample_set = find_regression_sample_set(
                context.workspace.id,
                payload.sample_set_id,
                session,
            )
            if sample_set.status != "active":
                raise HTTPException(status_code=409, detail="sample set is not active")
            sample_set_id = sample_set.id
            sample_set_name = sample_set.name
            stored_samples = list(session.scalars(
                select(RegressionSampleRecord)
                .where(
                    RegressionSampleRecord.workspace_id == context.workspace.id,
                    RegressionSampleRecord.sample_set_id == sample_set.id,
                    RegressionSampleRecord.status == "active",
                )
                .order_by(RegressionSampleRecord.created_at.asc()),
            ))
            batch_samples = [
                {"id": sample.id, "input": sample.input_text}
                for sample in stored_samples
            ]
        else:
            batch_samples = [
                {
                    "id": sample.sample_id or f"manual-sample-{index}",
                    "input": sample.input_text,
                }
                for index, sample in enumerate(payload.samples, start=1)
            ]

        if len(batch_samples) == 0:
            raise HTTPException(status_code=422, detail="至少需要 1 条回归样本")

        run, records = create_regression_run_from_samples(
            session=session,
            context=context,
            rubric=rubric,
            rubric_version=rubric_version,
            snapshot=snapshot,
            sample_set_id=sample_set_id,
            sample_set_name=sample_set_name,
            batch_samples=batch_samples,
        )
        record_success(
            session,
            context,
            action="evaluation.regression_run.create",
            target_type="regression_run",
            target_id=run.id,
            request=request,
        )
        session.commit()
        session.refresh(run)
        for record in records:
            session.refresh(record)
        return regression_run_to_read(run, records)

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

    @router.post(
        "/evaluations/rubrics",
        response_model=RubricRead,
        status_code=status.HTTP_201_CREATED,
    )
    def create_evaluation_rubric(
        payload: RubricWrite,
        request: Request,
        context_bundle: tuple[RequestContext, Session] = Depends(write_workspace_context),
    ) -> RubricRecord:
        context, session = context_bundle
        authorization_service.require_capability(
            session,
            context,
            "rubric.write",
            action="evaluation.rubric.create",
            target_type="rubric",
            target_id=None,
            request=request,
        )
        sort_order = session.scalar(
            select(func.max(RubricRecord.sort_order))
            .where(RubricRecord.workspace_id == context.workspace.id),
        ) or 0
        now = utc_now()
        record = RubricRecord(
            workspace_id=context.workspace.id,
            name=payload.name,
            artifact=payload.artifact,
            dimensions=[dimension.model_dump() for dimension in payload.dimensions],
            gate=payload.gate,
            pass_score=payload.pass_score,
            judge_type=payload.judge_type,
            judge_model=payload.judge_model,
            version="v0.1.0",
            status="draft",
            sort_order=sort_order + 1,
            created_at=now,
            updated_at=now,
        )
        session.add(record)
        session.flush()
        record_success(
            session,
            context,
            action="evaluation.rubric.create",
            target_type="rubric",
            target_id=record.id,
            request=request,
        )
        session.commit()
        session.refresh(record)
        return record

    @router.patch("/evaluations/rubrics/{rubric_id}", response_model=RubricRead)
    def update_evaluation_rubric(
        rubric_id: str,
        payload: RubricWrite,
        request: Request,
        context_bundle: tuple[RequestContext, Session] = Depends(write_workspace_context),
    ) -> RubricRecord:
        context, session = context_bundle
        authorization_service.require_capability(
            session,
            context,
            "rubric.write",
            action="evaluation.rubric.update",
            target_type="rubric",
            target_id=rubric_id,
            request=request,
        )
        record = find_rubric(context.workspace.id, rubric_id, session)
        if record.status == "disabled":
            raise HTTPException(status_code=409, detail="已停用评分量规不允许编辑")
        record.name = payload.name
        record.artifact = payload.artifact
        record.dimensions = [dimension.model_dump() for dimension in payload.dimensions]
        record.gate = payload.gate
        record.pass_score = payload.pass_score
        record.judge_type = payload.judge_type
        record.judge_model = payload.judge_model
        record.updated_at = utc_now()
        record_success(
            session,
            context,
            action="evaluation.rubric.update",
            target_type="rubric",
            target_id=record.id,
            request=request,
        )
        session.commit()
        session.refresh(record)
        return record

    @router.get(
        "/evaluations/rubrics/{rubric_id}/versions",
        response_model=list[RubricVersionRead],
    )
    def list_evaluation_rubric_versions(
        rubric_id: str,
        request: Request,
        context_bundle: tuple[RequestContext, Session] = Depends(workspace_context),
    ) -> list[RubricVersionRecord]:
        context, session = context_bundle
        authorization_service.require_capability(
            session,
            context,
            "asset.read",
            action="evaluation.rubric.version.list",
            target_type="rubric",
            target_id=rubric_id,
            request=request,
        )
        find_rubric(context.workspace.id, rubric_id, session)
        return list(session.scalars(
            select(RubricVersionRecord)
            .where(
                RubricVersionRecord.workspace_id == context.workspace.id,
                RubricVersionRecord.rubric_id == rubric_id,
            )
            .order_by(RubricVersionRecord.created_at.desc()),
        ))

    @router.post(
        "/evaluations/rubrics/{rubric_id}/publish",
        response_model=RubricVersionRead,
        status_code=status.HTTP_201_CREATED,
    )
    def publish_evaluation_rubric(
        rubric_id: str,
        request: Request,
        context_bundle: tuple[RequestContext, Session] = Depends(write_workspace_context),
    ) -> RubricVersionRecord:
        context, session = context_bundle
        authorization_service.require_capability(
            session,
            context,
            "rubric.publish",
            action="evaluation.rubric.publish",
            target_type="rubric",
            target_id=rubric_id,
            request=request,
        )
        record = find_rubric(context.workspace.id, rubric_id, session)
        if record.status == "disabled":
            raise HTTPException(status_code=409, detail="已停用评分量规不允许发布")
        version = next_rubric_version(session, context.workspace.id, rubric_id)
        record.version = version
        record.status = "active"
        record.updated_at = utc_now()
        published = RubricVersionRecord(
            workspace_id=context.workspace.id,
            rubric_id=rubric_id,
            version=version,
            snapshot=rubric_snapshot(record),
        )
        session.add(published)
        session.flush()
        record_success(
            session,
            context,
            action="evaluation.rubric.publish",
            target_type="rubric",
            target_id=record.id,
            request=request,
        )
        session.commit()
        session.refresh(published)
        return published

    @router.post("/evaluations/rubrics/{rubric_id}/deactivate", response_model=RubricRead)
    def deactivate_evaluation_rubric(
        rubric_id: str,
        request: Request,
        context_bundle: tuple[RequestContext, Session] = Depends(write_workspace_context),
    ) -> RubricRecord:
        context, session = context_bundle
        authorization_service.require_capability(
            session,
            context,
            "asset.deactivate",
            action="evaluation.rubric.deactivate",
            target_type="rubric",
            target_id=rubric_id,
            request=request,
        )
        record = find_rubric(context.workspace.id, rubric_id, session)
        record.status = "disabled"
        record.updated_at = utc_now()
        record_success(
            session,
            context,
            action="evaluation.rubric.deactivate",
            target_type="rubric",
            target_id=record.id,
            request=request,
        )
        session.commit()
        session.refresh(record)
        return record

    @router.get("/evaluations/records", response_model=list[EvaluationRecordRead])
    def list_evaluation_records(
        request: Request,
        context_bundle: tuple[RequestContext, Session] = Depends(workspace_context),
    ) -> list[EvaluationRecord]:
        context, session = context_bundle
        authorization_service.require_capability(
            session,
            context,
            "asset.read",
            action="evaluation.record.list",
            target_type="workspace",
            target_id=context.workspace.id,
            request=request,
        )
        return list(session.scalars(
            select(EvaluationRecord)
            .where(EvaluationRecord.workspace_id == context.workspace.id)
            .order_by(EvaluationRecord.created_at.desc()),
        ))

    @router.post(
        "/evaluations/rubrics/{rubric_id}/evaluate",
        response_model=EvaluationRecordRead,
        status_code=status.HTTP_201_CREATED,
    )
    def run_rubric_evaluation(
        rubric_id: str,
        payload: EvaluationRunCreate,
        request: Request,
        context_bundle: tuple[RequestContext, Session] = Depends(write_workspace_context),
    ) -> EvaluationRecord:
        context, session = context_bundle
        authorization_service.require_capability(
            session,
            context,
            "evaluation.run",
            action="evaluation.run",
            target_type="rubric",
            target_id=rubric_id,
            request=request,
        )
        rubric = find_rubric(context.workspace.id, rubric_id, session)
        if rubric.status != "active":
            raise HTTPException(status_code=409, detail="只有已启用评分量规可以运行评估")
        rubric_version, snapshot = active_rubric_snapshot(
            session,
            context.workspace.id,
            rubric,
        )
        (
            dimension_scores,
            score,
            status_value,
            rationale,
            evaluator_type,
            evaluator_model,
            evaluator_input,
        ) = evaluate_with_rubric_snapshot(
            snapshot,
            payload.artifact_text,
            rubric_version=rubric_version,
            subject_type=payload.subject_type,
            subject_id=payload.subject_id,
        )
        record = EvaluationRecord(
            workspace_id=context.workspace.id,
            rubric_id=rubric.id,
            rubric_version=rubric_version,
            rubric_snapshot=snapshot,
            subject_type=payload.subject_type,
            subject_id=payload.subject_id,
            artifact_text=payload.artifact_text,
            dimension_scores=dimension_scores,
            score=score,
            status=status_value,
            rationale=rationale,
            evaluator_type=evaluator_type,
            evaluator_model=evaluator_model,
            evaluator_input=evaluator_input,
            created_by=context.user.id,
        )
        session.add(record)
        session.flush()
        record_success(
            session,
            context,
            action="evaluation.run",
            target_type="rubric",
            target_id=rubric.id,
            request=request,
        )
        session.commit()
        session.refresh(record)
        return record

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
