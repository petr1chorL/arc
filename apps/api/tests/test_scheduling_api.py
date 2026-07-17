from datetime import timedelta

from sqlalchemy import func, select

from api_test_support import create_authenticated_client, csrf_headers, workspace_url
from app.models import (
    ExecutionJobRecord,
    ScheduleDispatchRecord,
    WorkflowRunRecord,
    WorkflowScheduleRecord,
    utc_now,
)
from app.worker import ExecutionQueueWorker
from test_execution_api import (
    FakeGateway,
    FakeModelResult,
    create_published_agent,
    create_published_workflow,
)


def create_schedule(client, workspace_id: str, workflow: dict, **overrides) -> dict:
    versions = client.get(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/versions"),
    ).json()
    payload = {
        "name": "Daily insight schedule",
        "workflowId": workflow["id"],
        "workflowVersion": versions[0]["version"],
        "cronExpression": "0 9 * * 1-5",
        "timezone": "Asia/Shanghai",
        "input": '{"topic":"daily insight"}',
        "status": "active",
    }
    payload.update(overrides)
    response = client.post(
        workspace_url(workspace_id, "/schedules"),
        json=payload,
        headers=csrf_headers(client),
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_schedule_crud_validates_cron_timezone_and_published_version(tmp_path):
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'schedule-crud.db'}",
    )
    agent, version = create_published_agent(client, workspace_id)
    workflow = create_published_workflow(client, workspace_id, agent, version)
    schedule = create_schedule(client, workspace_id, workflow)

    assert schedule["workflowName"] == "Execution Workflow"
    assert schedule["workflowVersion"].startswith("v")
    assert schedule["status"] == "active"
    assert schedule["nextRunAt"] is not None
    listed = client.get(workspace_url(workspace_id, "/schedules"))
    assert listed.status_code == 200
    assert [item["id"] for item in listed.json()] == [schedule["id"]]

    invalid_cron = client.post(
        workspace_url(workspace_id, "/schedules"),
        json={
            "name": "Bad cron",
            "workflowId": workflow["id"],
            "workflowVersion": schedule["workflowVersion"],
            "cronExpression": "not a cron",
            "timezone": "Asia/Shanghai",
            "input": "{}",
        },
        headers=csrf_headers(client),
    )
    assert invalid_cron.status_code == 422

    invalid_timezone = client.patch(
        workspace_url(workspace_id, f"/schedules/{schedule['id']}"),
        json={"timezone": "Mars/Olympus"},
        headers=csrf_headers(client),
    )
    assert invalid_timezone.status_code == 422
    invalid_input = client.patch(
        workspace_url(workspace_id, f"/schedules/{schedule['id']}"),
        json={"input": "{"},
        headers=csrf_headers(client),
    )
    assert invalid_input.status_code == 422


    pause = client.post(
        workspace_url(workspace_id, f"/schedules/{schedule['id']}/pause"),
        headers=csrf_headers(client),
    )
    assert pause.status_code == 200
    assert pause.json()["status"] == "paused"
    assert pause.json()["nextRunAt"] is None

    resume = client.post(
        workspace_url(workspace_id, f"/schedules/{schedule['id']}/resume"),
        headers=csrf_headers(client),
    )
    assert resume.status_code == 200
    assert resume.json()["status"] == "active"
    assert resume.json()["nextRunAt"] is not None


def test_schedule_rejects_workflow_version_from_another_workspace(tmp_path):
    client, source_workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'schedule-workspace-isolation.db'}",
    )
    agent, version = create_published_agent(client, source_workspace_id)
    workflow = create_published_workflow(client, source_workspace_id, agent, version)
    workflow_version = client.get(
        workspace_url(source_workspace_id, f"/workflows/{workflow['id']}/versions"),
    ).json()[0]
    target = client.post(
        "/api/workspaces",
        json={"name": "Target", "slug": "schedule-target"},
        headers=csrf_headers(client),
    ).json()

    response = client.post(
        workspace_url(target["id"], "/schedules"),
        json={
            "name": "Foreign schedule",
            "workflowId": workflow["id"],
            "workflowVersion": workflow_version["version"],
            "cronExpression": "0 9 * * *",
            "timezone": "UTC",
            "input": "{}",
        },
        headers=csrf_headers(client),
    )
    assert response.status_code == 422


def test_worker_dispatches_due_schedule_once_and_executes_queued_run(tmp_path):
    gateway = FakeGateway([FakeModelResult("Scheduled workflow completed.")])
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'schedule-worker.db'}",
        model_gateway=gateway,
    )
    agent, version = create_published_agent(client, workspace_id)
    workflow = create_published_workflow(client, workspace_id, agent, version)
    schedule = create_schedule(client, workspace_id, workflow)
    with client.app.state.session_factory() as session:
        record = session.get(WorkflowScheduleRecord, schedule["id"])
        record.next_run_at = utc_now() - timedelta(minutes=1)
        session.commit()

    worker = ExecutionQueueWorker(
        session_factory=client.app.state.session_factory,
        execution_service=client.app.state.execution_service,
        schedule_service=client.app.state.schedule_service,
        workspace_ids=[workspace_id],
        worker_id="schedule-worker",
    )

    assert worker.process_once() == 1
    assert worker.process_once() == 0
    with client.app.state.session_factory() as session:
        assert session.scalar(select(func.count()).select_from(ScheduleDispatchRecord)) == 1
        dispatch = session.scalar(select(ScheduleDispatchRecord))
        assert dispatch.status == "enqueued"
        assert dispatch.run_id is not None
        assert session.scalar(select(func.count()).select_from(WorkflowRunRecord)) == 1
        job = session.scalar(select(ExecutionJobRecord))
        assert job.status == "succeeded"
        record = session.get(WorkflowScheduleRecord, schedule["id"])
        assert record.last_run_id == dispatch.run_id
        assert record.next_run_at > dispatch.scheduled_for
    assert len(gateway.calls) == 1


def test_due_schedule_skips_when_previous_run_is_still_active(tmp_path):
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'schedule-overlap.db'}",
    )
    agent, version = create_published_agent(client, workspace_id)
    workflow = create_published_workflow(client, workspace_id, agent, version)
    schedule = create_schedule(client, workspace_id, workflow)

    trigger = client.post(
        workspace_url(workspace_id, f"/schedules/{schedule['id']}/trigger"),
        headers=csrf_headers(client),
    )
    assert trigger.status_code == 201
    assert trigger.json()["status"] == "enqueued"
    with client.app.state.session_factory() as session:
        record = session.get(WorkflowScheduleRecord, schedule["id"])
        record.next_run_at = utc_now() - timedelta(minutes=1)
        session.commit()

    with client.app.state.session_factory() as session:
        dispatched = client.app.state.schedule_service.dispatch_due(
            session=session,
            workspace_id=workspace_id,
            execution_service=client.app.state.execution_service,
        )
        assert dispatched == 0

    history = client.get(
        workspace_url(workspace_id, f"/schedules/{schedule['id']}/dispatches"),
    )
    assert history.status_code == 200
    assert [item["status"] for item in history.json()] == ["skipped", "enqueued"]
    assert "overlap" in history.json()[0]["reason"]
    with client.app.state.session_factory() as session:
        assert session.scalar(select(func.count()).select_from(WorkflowRunRecord)) == 1
        assert session.scalar(select(func.count()).select_from(ExecutionJobRecord)) == 1
