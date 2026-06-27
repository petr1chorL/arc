from api_test_support import create_authenticated_client, csrf_headers, workspace_url
from app.models import ExecutionJobRecord
from app.worker import ExecutionQueueWorker
from test_execution_api import (
    FakeGateway,
    FakeModelResult,
    create_published_agent,
    create_published_workflow,
)


def test_execution_queue_worker_processes_queued_workflow_run(tmp_path):
    gateway = FakeGateway([
        FakeModelResult("The resident worker completed this workflow."),
    ])
    database_url = f"sqlite:///{tmp_path / 'execution-worker.db'}"
    client, workspace_id = create_authenticated_client(database_url, model_gateway=gateway)
    agent, version = create_published_agent(client, workspace_id)
    workflow = create_published_workflow(client, workspace_id, agent, version)
    response = client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/runs"),
        json={"input": "Run this workflow from the worker.", "asyncMode": True},
        headers=csrf_headers(client),
    )
    run_id = response.json()["id"]

    worker = ExecutionQueueWorker(
        session_factory=client.app.state.session_factory,
        execution_service=client.app.state.execution_service,
        workspace_ids=[workspace_id],
        worker_id="test-worker",
    )

    assert worker.process_once() == 1
    assert worker.process_until_idle(max_cycles=3) == 0
    assert len(gateway.calls) == 1
    with client.app.state.session_factory() as session:
        job = session.query(ExecutionJobRecord).one()
        assert job.status == "succeeded"
        assert job.locked_by == "test-worker"

    run_response = client.get(workspace_url(workspace_id, f"/runs/{run_id}"))
    assert run_response.status_code == 200
    assert run_response.json()["status"] == "已完成"
