from datetime import timedelta

from fastapi.testclient import TestClient
from sqlalchemy import select

from api_test_support import FIXED_NOW, create_authenticated_client, workspace_url
from app.models import (
    AuditEventRecord,
    HumanTaskRecord,
    NodeRunRecord,
    OrganizationRecord,
    ReviewerRecord,
    ReviewGroupRecord,
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


def create_human_task(
    client: TestClient,
    workspace_id: str,
    *,
    title: str,
    status: str,
    sla_status: str,
    due_offset_minutes: int,
    escalation_offset_minutes: int,
    reviewer_id: str | None = None,
    group_id: str | None = None,
) -> str:
    run = create_run(
        client,
        workspace_id,
        name=title,
        status="需介入",
        current_node="人工审核",
        duration_ms=500,
        started_offset_minutes=-30,
    )
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
            artifact_version_id=f"artifact-{title}",
            title=title,
            status=status,
            assignment_type="direct_reviewer" if reviewer_id else "group_claim",
            assignee_reviewer_id=reviewer_id,
            assignee_group_id=group_id,
            review_policy="any_one",
            required_approvals=1,
            participant_snapshot=[reviewer_id] if reviewer_id else [],
            due_at=FIXED_NOW + timedelta(minutes=due_offset_minutes),
            escalation_at=FIXED_NOW + timedelta(minutes=escalation_offset_minutes),
            sla_status=sla_status,
            escalation_group_id=group_id,
            created_at=FIXED_NOW + timedelta(minutes=-20),
            updated_at=FIXED_NOW + timedelta(minutes=-10),
        )
        session.add(task)
        session.commit()
        return task.id


def create_review_directory(client: TestClient, workspace_id: str) -> tuple[str, str]:
    with client.app.state.session_factory() as session:
        reviewer = ReviewerRecord(
            workspace_id=workspace_id,
            user_id="reviewer-user",
            name="产品审核人",
            role="产品审核人",
            is_active=True,
        )
        group = ReviewGroupRecord(
            workspace_id=workspace_id,
            name="产品审核组",
            assignment_mode="group_claim",
            is_escalation_group=True,
        )
        session.add_all([reviewer, group])
        session.commit()
        return reviewer.id, group.id


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


def test_observability_run_detail_includes_trace_context(tmp_path):
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'observability-trace.db'}",
    )
    run = create_run(
        client,
        workspace_id,
        name="带 Trace 的待人工流程",
        status="需介入",
        current_node="人工审核",
        duration_ms=1500,
        started_offset_minutes=-10,
    )
    create_human_task_for_run(client, workspace_id, run)

    response = client.get(workspace_url(workspace_id, f"/observability/runs/{run.id}"))

    assert response.status_code == 200
    body = response.json()
    assert body["traceId"] == f"trace-{run.id}"
    assert body["nodes"][0]["traceId"] == body["traceId"]
    assert body["nodes"][0]["spanId"] == f"span-{body['nodes'][0]['id']}"
    assert body["nodes"][0]["parentSpanId"] is None
    assert body["nodes"][1]["traceId"] == body["traceId"]
    assert body["nodes"][1]["parentSpanId"] == body["nodes"][0]["spanId"]
    assert body["auditEvents"][0]["traceId"] == body["traceId"]
    assert body["auditEvents"][0]["spanId"] == body["nodes"][1]["spanId"]

    with client.app.state.session_factory() as session:
        stored_run = session.get(WorkflowRunRecord, run.id)
        stored_nodes = list(session.scalars(
            select(NodeRunRecord)
            .where(NodeRunRecord.run_id == run.id)
            .order_by(NodeRunRecord.started_at.asc()),
        ))
        assert stored_run is not None
        assert stored_run.trace_id == body["traceId"]
        assert stored_nodes[1].parent_span_id == stored_nodes[0].span_id


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


def test_observability_human_sla_overview_counts_active_backlog_and_risks(tmp_path):
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'observability-human-sla.db'}",
    )
    reviewer_id, group_id = create_review_directory(client, workspace_id)
    overdue_id = create_human_task(
        client,
        workspace_id,
        title="已逾期审核",
        status="待认领",
        sla_status="已逾期",
        due_offset_minutes=-20,
        escalation_offset_minutes=40,
        group_id=group_id,
    )
    create_human_task(
        client,
        workspace_id,
        title="即将到期审核",
        status="审核中",
        sla_status="即将到期",
        due_offset_minutes=15,
        escalation_offset_minutes=60,
        reviewer_id=reviewer_id,
    )
    create_human_task(
        client,
        workspace_id,
        title="已升级审核",
        status="待认领",
        sla_status="已升级",
        due_offset_minutes=-60,
        escalation_offset_minutes=-5,
        group_id=group_id,
    )
    create_human_task(
        client,
        workspace_id,
        title="恢复失败审核",
        status="恢复失败",
        sla_status="正常",
        due_offset_minutes=120,
        escalation_offset_minutes=240,
        reviewer_id=reviewer_id,
    )
    create_human_task(
        client,
        workspace_id,
        title="已完成审核不应统计",
        status="已通过",
        sla_status="已逾期",
        due_offset_minutes=-120,
        escalation_offset_minutes=-60,
        reviewer_id=reviewer_id,
    )

    response = client.get(workspace_url(workspace_id, "/observability/human-sla"))

    assert response.status_code == 200
    body = response.json()
    assert body["totals"] == {
        "activeTasks": 4,
        "unclaimed": 2,
        "inReview": 1,
        "dueSoon": 1,
        "overdue": 1,
        "escalated": 1,
        "resumeFailed": 1,
    }
    overdue_risk = next(item for item in body["risks"] if item["taskId"] == overdue_id)
    assert overdue_risk["severity"] == "critical"
    assert overdue_risk["nextAction"] == "进入人工审核页处理该任务"
    assert {item["id"] for item in body["reviewers"]} == {reviewer_id}
    assert {item["id"] for item in body["groups"]} == {group_id}


def test_observability_human_sla_filters_by_reviewer_and_group(tmp_path):
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'observability-human-sla-filter.db'}",
    )
    reviewer_id, group_id = create_review_directory(client, workspace_id)
    create_human_task(
        client,
        workspace_id,
        title="指定审核人任务",
        status="审核中",
        sla_status="即将到期",
        due_offset_minutes=15,
        escalation_offset_minutes=60,
        reviewer_id=reviewer_id,
    )
    create_human_task(
        client,
        workspace_id,
        title="审核组任务",
        status="待认领",
        sla_status="已逾期",
        due_offset_minutes=-15,
        escalation_offset_minutes=60,
        group_id=group_id,
    )

    reviewer_response = client.get(
        workspace_url(workspace_id, f"/observability/human-sla?reviewerId={reviewer_id}"),
    )
    group_response = client.get(
        workspace_url(workspace_id, f"/observability/human-sla?groupId={group_id}"),
    )

    assert reviewer_response.status_code == 200
    assert reviewer_response.json()["totals"]["activeTasks"] == 1
    assert reviewer_response.json()["risks"][0]["title"] == "指定审核人任务"
    assert group_response.status_code == 200
    assert group_response.json()["totals"]["activeTasks"] == 1
    assert group_response.json()["risks"][0]["title"] == "审核组任务"


def test_observability_cost_usage_groups_by_workflow_and_model(tmp_path):
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'observability-cost-usage.db'}",
    )
    create_run(
        client,
        workspace_id,
        name="新品研究流程",
        status="已完成",
        current_node="流程完成",
        duration_ms=900,
        started_offset_minutes=-30,
        prompt_tokens=100,
        completion_tokens=50,
        cost_usd=0.15,
    )
    create_run(
        client,
        workspace_id,
        name="新品研究流程",
        status="已完成",
        current_node="流程完成",
        duration_ms=800,
        started_offset_minutes=-20,
        prompt_tokens=40,
        completion_tokens=20,
        cost_usd=0.06,
    )
    create_run(
        client,
        workspace_id,
        name="价格监控流程",
        status="失败",
        current_node="价格抓取",
        duration_ms=700,
        started_offset_minutes=-10,
        prompt_tokens=30,
        completion_tokens=10,
        cost_usd=0.04,
    )
    with client.app.state.session_factory() as session:
        price_run = session.scalar(
            select(WorkflowRunRecord).where(
                WorkflowRunRecord.workspace_id == workspace_id,
                WorkflowRunRecord.name == "价格监控流程",
            ),
        )
        assert price_run is not None
        price_run.model = "deepseek-reasoner"
        for node in session.scalars(
            select(NodeRunRecord).where(NodeRunRecord.run_id == price_run.id),
        ):
            node.model = "deepseek-reasoner"
        session.commit()

    response = client.get(workspace_url(workspace_id, "/observability/cost-usage"))

    assert response.status_code == 200
    body = response.json()
    assert body["costConfigured"] is False
    assert body["totals"] == {
        "runs": 3,
        "totalPromptTokens": 170,
        "totalCompletionTokens": 80,
        "totalTokens": 250,
        "totalCostUsd": 0.25,
    }
    assert body["byWorkflow"][0] == {
        "name": "新品研究流程",
        "runs": 2,
        "promptTokens": 140,
        "completionTokens": 70,
        "totalTokens": 210,
        "costUsd": 0.21,
        "averageScore": 88,
    }
    assert body["byModel"][0]["name"] == "deepseek-v4-pro"
    assert body["byModel"][0]["runs"] == 2
    assert body["byModel"][1]["name"] == "deepseek-reasoner"
