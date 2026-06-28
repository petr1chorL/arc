from dataclasses import dataclass
from datetime import datetime, timedelta
import json
from time import perf_counter

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from app.agent_runtime import AgentRuntimeExecutor, AgentRuntimeRequest, quality_score
from app.config import Settings
from app.domain import topological_order
from app.human_tasks import HumanTaskService
from app.model_gateway import ModelGateway
from app.models import (
    AgentVersionRecord,
    ArtifactRecord,
    ArtifactVersionRecord,
    ExecutionJobRecord,
    HumanTaskRecord,
    HumanReviewRecord,
    ModelProviderRecord,
    NodeRunRecord,
    ResumeRequestRecord,
    ReviewDecisionRecord,
    ToolSkillAssetInvocationRecord,
    ToolSkillAssetRecord,
    WorkflowRunRecord,
    WorkflowVersionRecord,
    utc_now,
)
from app.tool_runtime import DisabledHttpToolGateway, ToolRuntimeExecutor


@dataclass
class ExecutionTotals:
    prompt_tokens: int = 0
    completion_tokens: int = 0
    cost_usd: float = 0


def _parse_object_path(path: str) -> list[str] | None:
    normalized = path.strip()
    if normalized == "$":
        return []
    if not normalized.startswith("$."):
        return None
    parts = [part for part in normalized[2:].split(".") if part]
    return parts if parts else None


def _extract_path_value(payload: object, path: str) -> object | None:
    parts = _parse_object_path(path)
    if parts is None:
        return None
    current = payload
    for part in parts:
        if not isinstance(current, dict) or part not in current:
            return None
        current = current[part]
    return current


def _assign_path_value(target: dict, path: str, value: object) -> bool:
    parts = _parse_object_path(path)
    if parts is None:
        return False
    if not parts:
        if isinstance(value, dict):
            target.update(value)
            return True
        return False
    current = target
    for part in parts[:-1]:
        nested = current.setdefault(part, {})
        if not isinstance(nested, dict):
            nested = {}
            current[part] = nested
        current = nested
    current[parts[-1]] = value
    return True


def _mapped_node_input(
    *,
    node_id: str,
    predecessors: list[str],
    edges: list[dict],
    node_outputs: dict[str, str],
) -> str | None:
    incoming_edges = [edge for edge in edges if edge.get("target") == node_id]
    mapped_payload: dict = {}
    mapped_any = False
    for edge in incoming_edges:
        source_id = edge.get("source")
        if source_id not in predecessors or source_id not in node_outputs:
            continue
        mappings = (edge.get("data") or {}).get("mappings", [])
        if not isinstance(mappings, list) or not mappings:
            continue
        try:
            source_payload = json.loads(node_outputs[source_id])
        except json.JSONDecodeError:
            continue
        for mapping in mappings:
            if not isinstance(mapping, dict):
                continue
            source_path = mapping.get("sourcePath", "")
            target_path = mapping.get("targetPath", "")
            if not isinstance(source_path, str) or not isinstance(target_path, str):
                continue
            value = _extract_path_value(source_payload, source_path)
            if value is None:
                continue
            if _assign_path_value(mapped_payload, target_path, value):
                mapped_any = True
    if not mapped_any:
        return None
    return json.dumps(mapped_payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


class ExecutionService:
    def __init__(
        self,
        gateway: ModelGateway,
        settings: Settings,
        human_task_service: HumanTaskService,
        tool_runtime: ToolRuntimeExecutor | None = None,
    ):
        self.gateway = gateway
        self.settings = settings
        self.human_task_service = human_task_service
        self.tool_runtime = tool_runtime or ToolRuntimeExecutor(
            http_gateway=DisabledHttpToolGateway(),
        )
        self.agent_runtime = AgentRuntimeExecutor(
            gateway=gateway,
            cost_calculator=self.calculate_cost,
        )

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
        tool_asset_refs = snapshot.get("toolAssetRefs", [])
        skill_asset_refs = snapshot.get("skillAssetRefs", [])
        tool_names = self._asset_ref_names(tool_asset_refs) or snapshot.get("tools", [])
        skill_names = self._asset_ref_names(skill_asset_refs) or snapshot.get("skills", [])
        tools = "、".join(tool_names) or "无"
        skills = "、".join(skill_names) or "无"
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
        tool_call_summaries = self._invoke_bound_http_tools(
            session=session,
            run=run,
            node_run=node_run,
            agent_id=agent_id,
            agent_version=agent_version,
            tool_asset_refs=tool_asset_refs,
            tool_names=snapshot.get("tools", []),
            input_text=input_text,
        )
        runtime_input = self._input_with_tool_summaries(input_text, tool_call_summaries)
        model_provider_id = snapshot.get("modelProviderId")
        model_secret_ref = snapshot.get("modelSecretRef", "")
        if model_provider_id and not model_secret_ref:
            provider = session.scalar(
                select(ModelProviderRecord).where(
                    ModelProviderRecord.id == model_provider_id,
                    ModelProviderRecord.workspace_id == run.workspace_id,
                ),
            )
            if provider is not None:
                model_secret_ref = provider.secret_ref
        result = self.agent_runtime.execute(
            AgentRuntimeRequest(
                workspace_id=run.workspace_id,
                run_id=run.id,
                node_id=node_id,
                node_name=node_name,
                agent_id=agent_id,
                agent_version=agent_version,
                input_text=runtime_input,
                system_prompt=effective_prompt,
                model=snapshot.get("model", ""),
                model_provider_id=model_provider_id,
                model_provider=snapshot.get("modelProvider", "openai-compatible"),
                model_base_url=snapshot.get("modelBaseUrl", ""),
                model_secret_ref=model_secret_ref,
                temperature=snapshot.get("temperature", 0.2),
                max_output_tokens=snapshot.get("maxOutputTokens", 2000),
                tools=tool_names,
                skills=skill_names,
            ),
            max_attempts=max_attempts,
        )
        node_run.output_text = result.output_text
        node_run.model = result.model
        node_run.prompt_tokens = result.prompt_tokens
        node_run.completion_tokens = result.completion_tokens
        node_run.total_tokens = result.total_tokens
        node_run.cost_usd = result.cost_usd
        node_run.score = result.score
        node_run.status = result.status
        node_run.attempts = result.attempts
        node_run.error = result.error
        node_run.completed_at = utc_now()
        node_run.duration_ms = result.duration_ms
        return node_run

    def _invoke_bound_http_tools(
        self,
        *,
        session: Session,
        run: WorkflowRunRecord,
        node_run: NodeRunRecord,
        agent_id: str,
        agent_version: str,
        tool_asset_refs: list[dict],
        tool_names: list[str],
        input_text: str,
    ) -> list[dict[str, str]]:
        tool_asset_ids = [
            str(ref["assetId"])
            for ref in tool_asset_refs
            if isinstance(ref, dict) and ref.get("assetId")
        ]
        if not tool_asset_ids and not tool_names:
            return []
        filters = [
            ToolSkillAssetRecord.workspace_id == run.workspace_id,
            ToolSkillAssetRecord.asset_type == "tool",
            ToolSkillAssetRecord.status == "active",
            ToolSkillAssetRecord.adapter_type == "http",
        ]
        if tool_asset_ids:
            filters.append(ToolSkillAssetRecord.id.in_(tool_asset_ids))
        else:
            filters.append(ToolSkillAssetRecord.name.in_(tool_names))
        assets = list(session.scalars(select(ToolSkillAssetRecord).where(*filters)))
        summaries: list[dict[str, str]] = []
        for asset in assets:
            runtime_result = self.tool_runtime.execute_http(
                config=asset.adapter_config,
                parameters={"input": input_text},
            )
            record = ToolSkillAssetInvocationRecord(
                workspace_id=run.workspace_id,
                asset_id=asset.id,
                asset_type=asset.asset_type,
                asset_name=asset.name,
                agent_id=agent_id,
                agent_version=agent_version,
                run_id=run.id,
                node_run_id=node_run.id,
                status=runtime_result.status,
                input_summary=runtime_result.input_summary,
                output_summary=runtime_result.output_summary,
                error=runtime_result.error,
                duration_ms=runtime_result.duration_ms,
                created_at=utc_now(),
            )
            session.add(record)
            session.flush()
            summaries.append({
                "assetName": asset.name,
                "status": runtime_result.status,
                "outputSummary": runtime_result.output_summary,
                "error": runtime_result.error,
            })
        return summaries

    @staticmethod
    def _asset_ref_names(asset_refs: list[dict]) -> list[str]:
        return [
            str(ref["assetName"])
            for ref in asset_refs
            if isinstance(ref, dict) and ref.get("assetName")
        ]

    @staticmethod
    def _input_with_tool_summaries(
        input_text: str,
        tool_call_summaries: list[dict[str, str]],
    ) -> str:
        if not tool_call_summaries:
            return input_text
        lines = ["", "", "工具调用结果："]
        for item in tool_call_summaries:
            summary = item["outputSummary"] or item["error"]
            lines.append(f"- {item['assetName']}（{item['status']}）：{summary}")
        return input_text + "\n".join(lines)

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

    def enqueue_workflow_version(
        self,
        *,
        session: Session,
        workflow_id: str,
        workflow_version: str,
        input_text: str,
        created_by: str,
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
            status="排队中",
            input_text=input_text,
            current_node="等待调度",
        )
        session.add(run)
        session.flush()
        session.add(ExecutionJobRecord(
            workspace_id=version.workspace_id,
            run_id=run.id,
            workflow_id=workflow_id,
            workflow_version=workflow_version,
            input_text=input_text,
            created_by=created_by,
        ))
        session.commit()
        session.refresh(run)
        return run

    def process_next_execution_job(
        self,
        *,
        session: Session,
        workspace_id: str,
        worker_id: str = "api-worker",
        lease_seconds: int = 300,
    ) -> WorkflowRunRecord | None:
        now = utc_now()
        job = session.scalar(
            select(ExecutionJobRecord)
            .where(
                ExecutionJobRecord.workspace_id == workspace_id,
                or_(
                    and_(
                        ExecutionJobRecord.status == "queued",
                        or_(
                            ExecutionJobRecord.next_attempt_at.is_(None),
                            ExecutionJobRecord.next_attempt_at <= now,
                        ),
                    ),
                    and_(
                        ExecutionJobRecord.status == "running",
                        ExecutionJobRecord.locked_until.is_not(None),
                        ExecutionJobRecord.locked_until < now,
                    ),
                ),
            )
            .order_by(ExecutionJobRecord.created_at.asc()),
        )
        if job is None:
            return None
        run = session.scalar(
            select(WorkflowRunRecord).where(
                WorkflowRunRecord.id == job.run_id,
                WorkflowRunRecord.workspace_id == workspace_id,
            ),
        )
        if run is None:
            job.status = "failed"
            job.error = "工作流运行记录不存在"
            job.completed_at = utc_now()
            session.commit()
            return None
        job.status = "running"
        job.attempts += 1
        job.started_at = now
        job.locked_by = worker_id
        job.locked_until = now + timedelta(seconds=lease_seconds)
        job.last_heartbeat_at = now
        job.next_attempt_at = None
        run.status = "运行中"
        run.error = ""
        run.completed_at = None
        session.commit()
        try:
            snapshot = self.workflow_snapshot(session, run)
            self.execute_workflow_from(
                session=session,
                run=run,
                snapshot=snapshot,
            )
            if run.status == "失败":
                self._retry_or_dead_letter_job(
                    job=job,
                    run=run,
                    error=run.error,
                )
            else:
                job.status = "succeeded"
                job.error = ""
                job.locked_until = None
                job.completed_at = utc_now()
            session.commit()
        except Exception:
            self._retry_or_dead_letter_job(
                job=job,
                run=run,
                error="后台执行失败，请稍后重试",
            )
            session.commit()
        session.refresh(run)
        return run

    def heartbeat_execution_job(
        self,
        *,
        session: Session,
        workspace_id: str,
        job_id: str,
        worker_id: str,
        lease_seconds: int = 300,
    ) -> ExecutionJobRecord | None:
        job = session.scalar(
            select(ExecutionJobRecord).where(
                ExecutionJobRecord.id == job_id,
                ExecutionJobRecord.workspace_id == workspace_id,
                ExecutionJobRecord.status == "running",
                ExecutionJobRecord.locked_by == worker_id,
            ),
        )
        if job is None:
            return None
        now = utc_now()
        job.last_heartbeat_at = now
        job.locked_until = now + timedelta(seconds=lease_seconds)
        session.commit()
        session.refresh(job)
        return job

    def requeue_execution_job(
        self,
        *,
        session: Session,
        workspace_id: str,
        job_id: str,
    ) -> ExecutionJobRecord | None:
        job = session.scalar(
            select(ExecutionJobRecord).where(
                ExecutionJobRecord.id == job_id,
                ExecutionJobRecord.workspace_id == workspace_id,
                ExecutionJobRecord.status == "dead_letter",
            ),
        )
        if job is None:
            return None
        run = session.scalar(
            select(WorkflowRunRecord).where(
                WorkflowRunRecord.id == job.run_id,
                WorkflowRunRecord.workspace_id == workspace_id,
            ),
        )
        now = utc_now()
        job.status = "queued"
        job.attempts = 0
        job.error = ""
        job.locked_by = ""
        job.locked_until = None
        job.last_heartbeat_at = None
        job.next_attempt_at = now
        job.completed_at = None
        job.dead_lettered_at = None
        if run is not None:
            run.status = "排队中"
            run.current_node = "等待重投"
            run.error = ""
            run.completed_at = None
        session.commit()
        session.refresh(job)
        return job

    def cancel_execution_job(
        self,
        *,
        session: Session,
        workspace_id: str,
        job_id: str,
    ) -> ExecutionJobRecord | None:
        job = session.scalar(
            select(ExecutionJobRecord).where(
                ExecutionJobRecord.id == job_id,
                ExecutionJobRecord.workspace_id == workspace_id,
                ExecutionJobRecord.status.in_(("queued", "running", "dead_letter")),
            ),
        )
        if job is None:
            return None
        run = session.scalar(
            select(WorkflowRunRecord).where(
                WorkflowRunRecord.id == job.run_id,
                WorkflowRunRecord.workspace_id == workspace_id,
            ),
        )
        now = utc_now()
        job.status = "canceled"
        job.error = "用户取消执行"
        job.locked_by = ""
        job.locked_until = None
        job.last_heartbeat_at = None
        job.next_attempt_at = None
        job.completed_at = now
        job.canceled_at = now
        if run is not None:
            run.status = "已取消"
            run.current_node = "已取消"
            run.error = job.error
            run.completed_at = now
        session.commit()
        session.refresh(job)
        return job

    @staticmethod
    def _retry_or_dead_letter_job(
        *,
        job: ExecutionJobRecord,
        run: WorkflowRunRecord,
        error: str,
    ) -> None:
        now = utc_now()
        job.error = error
        if job.attempts >= job.max_attempts:
            job.status = "dead_letter"
            job.completed_at = now
            job.dead_lettered_at = now
            job.locked_until = None
            run.status = "失败"
            run.error = error
            run.completed_at = now
            return
        job.status = "queued"
        job.locked_until = None
        job.next_attempt_at = now + ExecutionService._retry_backoff_delay(job.attempts)
        job.completed_at = None
        run.status = "排队中"
        run.current_node = "等待重试"
        run.error = error
        run.completed_at = None

    @staticmethod
    def _retry_backoff_delay(attempts: int) -> timedelta:
        retry_index = max(attempts - 1, 0)
        seconds = min(30 * (2 ** retry_index), 15 * 60)
        return timedelta(seconds=seconds)

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
            node_input = _mapped_node_input(
                node_id=node_id,
                predecessors=predecessors[node_id],
                edges=snapshot["edges"],
                node_outputs=node_outputs,
            ) or "\n".join(
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
            artifact = ArtifactRecord(
                workspace_id=run.workspace_id,
                run_id=run.id,
                source_node_run_id=node_runs[-1].id,
                content=run.output_text,
                score=run.score,
            )
            session.add(artifact)
            session.flush()
            output_data_object_ref = None
            if run.workflow_id and run.workflow_version:
                output_data_object_ref = self._output_data_object_ref(
                    snapshot=self.workflow_snapshot(session, run),
                    node_runs=current_nodes,
                )
            session.add(ArtifactVersionRecord(
                workspace_id=run.workspace_id,
                artifact_id=artifact.id,
                content=run.output_text,
                data_object_definition_id=(
                    output_data_object_ref.get("definitionId")
                    if output_data_object_ref
                    else None
                ),
                data_object_version_id=(
                    output_data_object_ref.get("versionId")
                    if output_data_object_ref
                    else None
                ),
                data_object_snapshot=(
                    output_data_object_ref.get("snapshot")
                    if output_data_object_ref
                    else None
                ),
            ))
        session.commit()

    @staticmethod
    def _output_data_object_ref(
        *,
        snapshot: dict,
        node_runs: list[NodeRunRecord],
    ) -> dict | None:
        nodes_by_id = {
            node.get("id"): node
            for node in snapshot.get("nodes", [])
            if isinstance(node, dict)
        }
        for node_run in reversed(node_runs):
            node = nodes_by_id.get(node_run.node_id)
            data = node.get("data") if isinstance(node, dict) else None
            if not isinstance(data, dict):
                continue
            ref = data.get("outputDataObjectRef")
            if isinstance(ref, dict):
                return ref
        return None


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
