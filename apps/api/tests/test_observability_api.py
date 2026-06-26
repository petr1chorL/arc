from datetime import timedelta

from fastapi.testclient import TestClient
from sqlalchemy import select

from api_test_support import FIXED_NOW, create_authenticated_client, workspace_url
from app.models import (
    AuditEventRecord,
    HumanTaskRecord,
    NodeRunRecord,
    OrganizationRecord,
    WorkspaceRecord,
    WorkflowRunRecord,
)


def create_run(
    client: TestClient,
    workspace_id: str,
    *,
    name: str,
    status: str,
    current_node: str,
    duration_ms: int,
    started_offset_minutes: int,
    error: str = "",
    prompt_tokens: int = 0,
    completion_tokens: int = 0,
    cost_usd: float = 0,
) -> WorkflowRunRecord:
    with client.app.state.session_factory() as session:
        run = WorkflowRunRecord(
            workspace_id=workspace_id,
            name=name,
            workflow_id=f"workflow-{name}",
            workflow_version="v1.0.0",
            status=status,
            input_text=f"input for {name}",
            output_text=f"output for {name}",
            score=88 if status == "已完成" else None,
            model="deepseek-v4-pro",
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=prompt_tokens + completion_tokens,
            cost_usd=cost_usd,
            duration_ms=duration_ms,
            current_node=current_node,
            error=error,
            started_at=FIXED_NOW + timedelta(minutes=started_offset_minutes),
            completed_at=(
                FIXED_NOW + timedelta(minutes=started_offset_minutes, milliseconds=duration_ms)
                if status in {"已完成", "失败", "恢复失败"}
                else None
            ),
        )
        session.add(run)
        session.flush()
        session.add_all([
            NodeRunRecord(
                workspace_id=workspace_id,
                run_id=run.id,
                node_id="agent-1",
                node_type="agent",
                node_name="生成草稿",
                status="已完成" if status != "失败" else "失败",
                input_text=run.input_text,
                output_text=run.output_text,
                model=run.model,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                total_tokens=prompt_tokens + completion_tokens,
                cost_usd=cost_usd,
                duration_ms=max(duration_ms - 100, 0),
                attempts=2 if status == "失败" else 1,
                score=run.score,
                error=error,
                started_at=run.started_at,
                completed_at=run.completed_at,
            ),
            NodeRunRecord(
                workspace_id=workspace_id,
                run_id=run.id,
                node_id="human-1",
                node_type="human",
                node_name="人工审核",
                status="等待审核" if status == "需介入" else status,
                input_text=run.output_text,
                output_text=run.output_text,
                duration_ms=100,
                attempts=1,
                started_at=run.started_at + timedelta(milliseconds=max(duration_ms - 100, 0)),
                completed_at=run.completed_at,
            ),
        ])
        session.commit()
        session.refresh(run)
        return run


def create_human_task_for_run(client: TestClient, workspace_id: str, run: WorkflowRunRecord) -> str:
    with client.app.state.session_factory() as session:
        node_run = session.scalar(
            select(NodeRunRecord).where(
                NodeRunRecord.workspace_id == workspace_id,
                NodeRunRecord.run_id == run.id,
                NodeRunRecord.node_type == "human",
            ),
        )
        assert node_run is not None
        task = HumanTaskRecord(
            workspace_id=workspace_id,
            workflow_run_id=run.id,
            node_run_id=node_run.id,
            human_node_id="human-1",
            source_node_id="agent-1",
            artifact_version_id="artifact-version-observe",
            title="人工审核",
            status="待认领",
            assignment_type="group_claim",
            review_policy="any_one",
            required_approvals=1,
            participant_snapshot=[],
            due_at=FIXED_NOW + timedelta(hours=4),
            escalation_at=FIXED_NOW + timedelta(hours=8),
            created_at=FIXED_NOW,
            updated_at=FIXED_NOW,
        )
        session.add(task)
        session.flush()
        session.add(AuditEventRecord(
            workspace_id=workspace_id,
            human_task_id=task.id,
            event_type="task_created",
            actor_id="system",
            action="task_created",
            target_type="human_task",
            target_id=task.id,
            outcome="success",
            after_status=task.status,
            payload={"runId": run.id},
            created_at=FIXED_NOW,
        ))
        session.commit()
        return task.id


def create_second_workspace(client: TestClient) -> str:
    with client.app.state.session_factory() as session:
        organization = session.scalar(select(OrganizationRecord))
        assert organization is not None
        workspace = WorkspaceRecord(
            organization_id=organization.id,
            name="Other Workspace",
            slug="other-workspace",
            created_at=FIXED_NOW,
            updated_at=FIXED_NOW,
        )
        session.add(workspace)
        session.commit()
        return workspace.id


def test_observability_overview_prioritizes_risky_runs(tmp_path):
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'observability-overview.db'}",
    )
    completed = create_run(
        client,
        workspace_id,
        name="已完成流程",
        status="已完成",
        current_node="流程完成",
        duration_ms=900,
        started_offset_minutes=-30,
        prompt_tokens=20,
        completion_tokens=10,
        cost_usd=0.03,
    )
    failed = create_run(
        client,
        workspace_id,
        name="失败流程",
        status="失败",
        current_node="生成草稿",
        duration_ms=1200,
        started_offset_minutes=-20,
        error="模型调用失败",
        prompt_tokens=40,
        completion_tokens=0,
        cost_usd=0.04,
    )
    waiting = create_run(
        client,
        workspace_id,
        name="待人工流程",
        status="需介入",
        current_node="人工审核",
        duration_ms=1500,
        started_offset_minutes=-10,
        prompt_tokens=30,
        completion_tokens=15,
        cost_usd=0.05,
    )
    create_human_task_for_run(client, workspace_id, waiting)

    response = client.get(workspace_url(workspace_id, "/observability/overview"))

    assert response.status_code == 200
    body = response.json()
    assert body["totals"] == {
        "runs": 3,
        "succeeded": 1,
        "failed": 1,
        "waitingForHuman": 1,
        "resumeFailed": 0,
        "averageDurationMs": 1200,
        "totalPromptTokens": 90,
        "totalCompletionTokens": 25,
        "totalCostUsd": 0.12,
    }
    assert [item["id"] for item in body["recentRuns"]] == [
        failed.id,
        waiting.id,
        completed.id,
    ]
    assert body["recentRuns"][0]["priority"] == "critical"
    assert body["recentRuns"][0]["nextAction"] == "查看失败节点和错误信息"
    assert body["recentRuns"][1]["priority"] == "warning"
    assert body["recentRuns"][1]["nextAction"] == "进入人工审核处理 Human Task"
    assert body["risks"][0]["runId"] == failed.id
    assert body["risks"][1]["runId"] == waiting.id


def test_observability_run_detail_includes_nodes_and_human_tasks(tmp_path):
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'observability-detail.db'}",
    )
    run = create_run(
        client,
        workspace_id,
        name="待人工流程",
        status="需介入",
        current_node="人工审核",
        duration_ms=1500,
        started_offset_minutes=-10,
        prompt_tokens=30,
        completion_tokens=15,
        cost_usd=0.05,
    )
    task_id = create_human_task_for_run(client, workspace_id, run)

    response = client.get(workspace_url(workspace_id, f"/observability/runs/{run.id}"))

    assert response.status_code == 200
    body = response.json()
    assert body["id"] == run.id
    assert body["workflowName"] == "待人工流程"
    assert [node["nodeType"] for node in body["nodes"]] == ["agent", "human"]
    assert body["nodes"][0]["attempts"] == 1
    assert body["humanTasks"][0]["id"] == task_id
    assert body["auditEvents"][0]["eventType"] == "task_created"


def test_observability_run_detail_is_workspace_scoped(tmp_path):
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'observability-scope.db'}",
    )
    other_workspace_id = create_second_workspace(client)
    other_run = create_run(
        client,
        other_workspace_id,
        name="其他空间流程",
        status="失败",
        current_node="生成草稿",
        duration_ms=1200,
        started_offset_minutes=-20,
        error="其他空间错误",
    )

    response = client.get(workspace_url(workspace_id, f"/observability/runs/{other_run.id}"))

    assert response.status_code == 404


def test_observability_overview_empty_state(tmp_path):
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'observability-empty.db'}",
    )

    response = client.get(workspace_url(workspace_id, "/observability/overview"))

    assert response.status_code == 200
    body = response.json()
    assert body["totals"]["runs"] == 0
    assert body["totals"]["averageDurationMs"] is None
    assert body["recentRuns"] == []
    assert body["risks"] == []
