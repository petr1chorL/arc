from dataclasses import dataclass
from datetime import datetime
from time import perf_counter

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import Settings
from app.domain import topological_order
from app.human_tasks import HumanTaskService
from app.model_gateway import ModelGateway
from app.models import (
    AgentVersionRecord,
    ArtifactRecord,
    ArtifactVersionRecord,
    HumanTaskRecord,
    HumanReviewRecord,
    NodeRunRecord,
    ResumeRequestRecord,
    ReviewDecisionRecord,
    WorkflowRunRecord,
    WorkflowVersionRecord,
    utc_now,
)


@dataclass
class ExecutionTotals:
    prompt_tokens: int = 0
    completion_tokens: int = 0
    cost_usd: float = 0


def quality_score(output: str) -> int:
    length = len(output.strip())
    if length == 0:
        return 0
    if length < 20:
        return 50
    return 100


class ExecutionService:
    def __init__(
        self,
        gateway: ModelGateway,
        settings: Settings,
        human_task_service: HumanTaskService,
    ):
        self.gateway = gateway
        self.settings = settings
        self.human_task_service = human_task_service

    def calculate_cost(self, prompt_tokens: int, completion_tokens: int) -> float:
        return round(
            prompt_tokens * self.settings.model_input_usd_per_million_tokens / 1_000_000
            + completion_tokens * self.settings.model_output_usd_per_million_tokens / 1_000_000,
            8,
        )

    def execute_agent(
        self,
        *,
        session: Session,
        run: WorkflowRunRecord,
        node_id: str,
        node_name: str,
        input_text: str,
        agent_id: str,
        agent_version: str,
        max_attempts: int = 2,
    ) -> NodeRunRecord:
        version = session.scalar(
            select(AgentVersionRecord).where(
                AgentVersionRecord.agent_id == agent_id,
                AgentVersionRecord.version == agent_version,
            ),
        )
        if version is None:
            raise RuntimeError(f"Agent 版本 {agent_id}@{agent_version} 不存在")
        snapshot = version.snapshot
        system_prompt = snapshot.get("systemPrompt", "").strip()
        role = snapshot.get("role", "")
        tools = "、".join(snapshot.get("tools", [])) or "无"
        skills = "、".join(snapshot.get("skills", [])) or "无"
        effective_prompt = (
            f"{system_prompt}\n\n职责：{role}\n可用工具：{tools}\n可用技能：{skills}"
        ).strip()
        node_run = NodeRunRecord(
            workspace_id=run.workspace_id,
            run_id=run.id,
            node_id=node_id,
            node_type="agent",
            node_name=node_name,
            agent_id=agent_id,
            agent_version=agent_version,
            input_text=input_text,
            started_at=utc_now(),
        )
        session.add(node_run)
        session.flush()
        started = perf_counter()
        for attempt in range(1, max_attempts + 1):
            try:
                result = self.gateway.complete(
                    system_prompt=effective_prompt,
                    user_input=input_text,
                    model=snapshot.get("model", ""),
                )
                node_run.output_text = result.content
                node_run.model = result.model
                node_run.prompt_tokens = result.prompt_tokens
                node_run.completion_tokens = result.completion_tokens
                node_run.total_tokens = result.prompt_tokens + result.completion_tokens
                node_run.cost_usd = self.calculate_cost(
                    result.prompt_tokens,
                    result.completion_tokens,
                )
                node_run.score = quality_score(result.content)
                node_run.status = "已完成"
                node_run.attempts = attempt
                node_run.completed_at = utc_now()
                node_run.duration_ms = int((perf_counter() - started) * 1000)
                return node_run
            except Exception:
                node_run.attempts = attempt
        node_run.status = "失败"
        node_run.error = "Agent 执行失败，请稍后重试"
        node_run.completed_at = utc_now()
        node_run.duration_ms = int((perf_counter() - started) * 1000)
        return node_run

    def run_agent_version(
        self,
        *,
        session: Session,
        agent_id: str,
        agent_version: str,
        input_text: str,
    ) -> WorkflowRunRecord:
        version = session.scalar(
            select(AgentVersionRecord).where(
                AgentVersionRecord.agent_id == agent_id,
                AgentVersionRecord.version == agent_version,
            ),
        )
        if version is None:
            raise RuntimeError("已发布 Agent 版本不存在")
        snapshot = version.snapshot
        run = WorkflowRunRecord(
            workspace_id=version.workspace_id,
            kind="agent",
            name=f"{snapshot['name']} 测试运行",
            agent_id=agent_id,
            agent_version=agent_version,
            input_text=input_text,
            current_node=snapshot["name"],
        )
        session.add(run)
        session.flush()
        started = perf_counter()
        node_run = self.execute_agent(
            session=session,
            run=run,
            node_id="agent-test",
            node_name=snapshot["name"],
            input_text=input_text,
            agent_id=agent_id,
            agent_version=agent_version,
        )
        self.finish_run(session, run, [node_run], started)
        return run

    def run_workflow_version(
        self,
        *,
        session: Session,
        workflow_id: str,
        workflow_version: str,
        input_text: str,
    ) -> WorkflowRunRecord:
        version = session.scalar(
            select(WorkflowVersionRecord).where(
                WorkflowVersionRecord.workflow_id == workflow_id,
                WorkflowVersionRecord.version == workflow_version,
            ),
        )
        if version is None:
            raise RuntimeError("已发布工作流版本不存在")
        snapshot = version.snapshot
        run = WorkflowRunRecord(
            workspace_id=version.workspace_id,
            kind="workflow",
            name=snapshot["name"],
            workflow_id=workflow_id,
            workflow_version=workflow_version,
            input_text=input_text,
        )
        session.add(run)
        session.flush()
        return self.execute_workflow_from(
            session=session,
            run=run,
            snapshot=snapshot,
        )

    def execute_workflow_from(
        self,
        *,
        session: Session,
        run: WorkflowRunRecord,
        snapshot: dict,
        start_node_id: str | None = None,
        seed_outputs: dict[str, str] | None = None,
    ) -> WorkflowRunRecord:
        started = perf_counter()
        existing_node_runs = list(session.scalars(
            select(NodeRunRecord)
            .where(NodeRunRecord.run_id == run.id)
            .order_by(NodeRunRecord.started_at.asc()),
        ))
        node_outputs: dict[str, str] = {}
        for existing in existing_node_runs:
            if existing.output_text:
                node_outputs[existing.node_id] = existing.output_text
        node_outputs.update(seed_outputs or {})
        node_runs = existing_node_runs
        segment_start = len(node_runs)
        predecessors: dict[str, list[str]] = {node["id"]: [] for node in snapshot["nodes"]}
        for edge in snapshot["edges"]:
            predecessors[edge["target"]].append(edge["source"])
        ordered_ids = topological_order(snapshot["nodes"], snapshot["edges"])
        nodes_by_id = {node["id"]: node for node in snapshot["nodes"]}
        start_index = ordered_ids.index(start_node_id) if start_node_id else 0
        for node_id in ordered_ids[start_index:]:
            node = nodes_by_id[node_id]
            node_input = "\n".join(
                node_outputs[source] for source in predecessors[node_id] if source in node_outputs
            ) or run.input_text
            run.current_node = node["data"].get("label", node_id)
            if node["type"] == "agent":
                node_run = self.execute_agent(
                    session=session,
                    run=run,
                    node_id=node_id,
                    node_name=run.current_node,
                    input_text=node_input,
                    agent_id=node["data"]["agentId"],
                    agent_version=node["data"]["agentVersion"],
                    max_attempts=int(node["data"].get("retryMaxAttempts", 2)),
                )
            elif node["type"] == "human":
                source_node_id = predecessors[node_id][-1]
                source_node_run = next(
                    item for item in reversed(node_runs) if item.node_id == source_node_id
                )
                node_run, _ = self.human_task_service.pause_for_review(
                    session=session,
                    run=run,
                    node=node,
                    node_input=node_input,
                    source_node_id=source_node_id,
                    source_node_run_id=source_node_run.id,
                    score=source_node_run.score,
                )
                node_runs.append(node_run)
                run.prompt_tokens = sum(item.prompt_tokens for item in node_runs)
                run.completion_tokens = sum(item.completion_tokens for item in node_runs)
                run.total_tokens = sum(item.total_tokens for item in node_runs)
                run.cost_usd = round(sum(item.cost_usd for item in node_runs), 8)
                run.model = next((item.model for item in reversed(node_runs) if item.model), "")
                run.duration_ms = int((perf_counter() - started) * 1000)
                session.commit()
                return run
            else:
                now = utc_now()
                node_run = NodeRunRecord(
                    workspace_id=run.workspace_id,
                    run_id=run.id,
                    node_id=node_id,
                    node_type=node["type"],
                    node_name=run.current_node,
                    status="已完成",
                    input_text=node_input,
                    output_text=node_input,
                    duration_ms=0,
                    attempts=1,
                    started_at=now,
                    completed_at=now,
                )
                session.add(node_run)
                session.flush()
            node_runs.append(node_run)
            if node_run.status == "失败":
                break
            node_outputs[node_id] = node_run.output_text
        self.finish_run(
            session,
            run,
            node_runs,
            started,
            outcome_nodes=node_runs[segment_start:],
        )
        return run

    def workflow_snapshot(
        self,
        session: Session,
        run: WorkflowRunRecord,
    ) -> dict:
        version = session.scalar(
            select(WorkflowVersionRecord).where(
                WorkflowVersionRecord.workflow_id == run.workflow_id,
                WorkflowVersionRecord.version == run.workflow_version,
            ),
        )
        if version is None:
            raise RuntimeError("工作流版本快照不存在")
        return version.snapshot

    def finish_run(
        self,
        session: Session,
        run: WorkflowRunRecord,
        node_runs: list[NodeRunRecord],
        started: float,
        outcome_nodes: list[NodeRunRecord] | None = None,
    ) -> None:
        current_nodes = outcome_nodes if outcome_nodes is not None else node_runs
        failed = next((node for node in current_nodes if node.status == "失败"), None)
        scored = [node.score for node in current_nodes if node.score is not None]
        run.output_text = current_nodes[-1].output_text if current_nodes else run.output_text
        run.score = min(scored) if scored else quality_score(run.output_text)
        run.prompt_tokens = sum(node.prompt_tokens for node in node_runs)
        run.completion_tokens = sum(node.completion_tokens for node in node_runs)
        run.total_tokens = sum(node.total_tokens for node in node_runs)
        run.cost_usd = round(sum(node.cost_usd for node in node_runs), 8)
        run.model = next((node.model for node in reversed(node_runs) if node.model), "")
        run.duration_ms = int((perf_counter() - started) * 1000)
        run.completed_at = utc_now()
        if failed:
            run.status = "失败"
            run.error = failed.error
            run.current_node = failed.node_name
        elif run.score < 60:
            run.status = "需介入"
            scored_node = next(
                (node for node in node_runs if node.score == run.score),
                node_runs[-1],
            )
            session.add(HumanReviewRecord(
                workspace_id=run.workspace_id,
                run_id=run.id,
                node_run_id=scored_node.id,
                title=f"复核低分产出：{scored_node.node_name}",
                reason="基础质量门禁未通过：输出内容少于 20 个字符。",
                score=run.score,
            ))
        else:
            run.status = "已完成"
        if node_runs:
            session.add(ArtifactRecord(
                workspace_id=run.workspace_id,
                run_id=run.id,
                source_node_run_id=node_runs[-1].id,
                content=run.output_text,
                score=run.score,
            ))
        session.commit()


class WorkflowResumeService:
    def __init__(
        self,
        execution_service: ExecutionService,
        human_task_service: HumanTaskService,
    ):
        self.execution_service = execution_service
        self.human_task_service = human_task_service

    def apply_outcome(
        self,
        *,
        session: Session,
        workspace_id: str,
        task_id: str,
        decision_id: str,
    ) -> HumanTaskRecord:
        task = session.scalar(
            select(HumanTaskRecord).where(
                HumanTaskRecord.id == task_id,
                HumanTaskRecord.workspace_id == workspace_id,
            ),
        )
        decision = session.scalar(
            select(ReviewDecisionRecord).where(
                ReviewDecisionRecord.id == decision_id,
                ReviewDecisionRecord.workspace_id == workspace_id,
                ReviewDecisionRecord.human_task_id == task_id,
            ),
        )
        if task is None or decision is None:
            raise RuntimeError("审核任务或决定不存在")
        existing = session.scalar(
            select(ResumeRequestRecord).where(
                ResumeRequestRecord.human_task_id == task.id,
                ResumeRequestRecord.decision_id == decision.id,
            ),
        )
        if existing is not None and existing.status == "succeeded":
            return task
        request = existing or ResumeRequestRecord(
            workspace_id=task.workspace_id,
            human_task_id=task.id,
            decision_id=decision.id,
            action=decision.decision,
        )
        if existing is None:
            session.add(request)
        request.status = "running"
        request.error = ""
        session.commit()
        try:
            self._execute_outcome(
                session=session,
                task=task,
                decision=decision,
            )
            task.status = {
                "approve": "已通过",
                "modify_and_approve": "修改后通过",
                "reject": "已驳回",
                "return_for_rerun": "已退回",
            }[decision.decision]
            request.status = "succeeded"
            request.completed_at = utc_now()
            self.human_task_service.audit(
                session,
                task=task,
                event_type="workflow_resume_succeeded",
                actor_id=decision.reviewer_id,
                payload={"action": decision.decision},
            )
            session.commit()
        except Exception:
            request.status = "failed"
            request.error = "工作流恢复失败，请稍后重试"
            task.status = "恢复失败"
            run = session.scalar(
                select(WorkflowRunRecord).where(
                    WorkflowRunRecord.id == task.workflow_run_id,
                    WorkflowRunRecord.workspace_id == workspace_id,
                ),
            )
            if run is not None:
                run.status = "恢复失败"
                run.error = request.error
            self.human_task_service.audit(
                session,
                task=task,
                event_type="workflow_resume_failed",
                actor_id="system",
                payload={"action": decision.decision},
            )
            session.commit()
        session.refresh(task)
        return task

    def retry(
        self,
        *,
        session: Session,
        workspace_id: str,
        task_id: str,
    ) -> HumanTaskRecord:
        request = session.scalar(
            select(ResumeRequestRecord)
            .join(HumanTaskRecord, HumanTaskRecord.id == ResumeRequestRecord.human_task_id)
            .where(
                ResumeRequestRecord.human_task_id == task_id,
                ResumeRequestRecord.status == "failed",
                HumanTaskRecord.workspace_id == workspace_id,
            )
            .order_by(ResumeRequestRecord.created_at.desc()),
        )
        if request is None:
            raise RuntimeError("没有可重试的恢复请求")
        return self.apply_outcome(
            session=session,
            workspace_id=workspace_id,
            task_id=task_id,
            decision_id=request.decision_id,
        )

    def _execute_outcome(
        self,
        *,
        session: Session,
        task: HumanTaskRecord,
        decision: ReviewDecisionRecord,
    ) -> None:
        run = session.scalar(
            select(WorkflowRunRecord).where(
                WorkflowRunRecord.id == task.workflow_run_id,
                WorkflowRunRecord.workspace_id == task.workspace_id,
            ),
        )
        human_node_run = session.scalar(
            select(NodeRunRecord).where(
                NodeRunRecord.id == task.node_run_id,
                NodeRunRecord.workspace_id == task.workspace_id,
            ),
        )
        artifact_version = session.scalar(
            select(ArtifactVersionRecord).where(
                ArtifactVersionRecord.id == task.artifact_version_id,
                ArtifactVersionRecord.workspace_id == task.workspace_id,
            ),
        )
        if run is None or human_node_run is None or artifact_version is None:
            raise RuntimeError("恢复执行所需数据不完整")
        now = utc_now()
        human_node_run.completed_at = now
        human_node_run.output_text = artifact_version.content
        snapshot = self.execution_service.workflow_snapshot(session, run)
        ordered_ids = topological_order(snapshot["nodes"], snapshot["edges"])
        if decision.decision == "reject":
            human_node_run.status = "已驳回"
            run.status = "已驳回"
            run.error = "人工审核已驳回"
            run.completed_at = now
            session.commit()
            return
        if decision.decision == "return_for_rerun":
            human_node_run.status = "已退回"
            run.status = "运行中"
            run.error = ""
            run.completed_at = None
            session.commit()
            self.execution_service.execute_workflow_from(
                session=session,
                run=run,
                snapshot=snapshot,
                start_node_id=task.source_node_id,
            )
            if run.status == "失败":
                raise RuntimeError("来源 Agent 重跑失败")
            return
        human_node_run.status = "已完成"
        run.status = "运行中"
        run.error = ""
        run.completed_at = None
        session.commit()
        human_index = ordered_ids.index(task.human_node_id)
        if human_index == len(ordered_ids) - 1:
            existing = list(session.scalars(
                select(NodeRunRecord)
                .where(NodeRunRecord.run_id == run.id)
                .order_by(NodeRunRecord.started_at.asc()),
            ))
            self.execution_service.finish_run(session, run, existing, perf_counter())
            return
        self.execution_service.execute_workflow_from(
            session=session,
            run=run,
            snapshot=snapshot,
            start_node_id=ordered_ids[human_index + 1],
            seed_outputs={task.human_node_id: artifact_version.content},
        )
        if run.status == "失败":
            raise RuntimeError("下游节点恢复执行失败")
