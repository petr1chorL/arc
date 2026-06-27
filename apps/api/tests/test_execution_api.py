from dataclasses import dataclass
from datetime import timedelta

from fastapi.testclient import TestClient
from sqlalchemy import select

from api_test_support import create_authenticated_client, csrf_headers, workspace_url
from app.models import AuditEventRecord, ExecutionJobRecord, WorkflowRunRecord, utc_now


@dataclass
class FakeModelResult:
    content: str
    model: str = "fake-model"
    prompt_tokens: int = 12
    completion_tokens: int = 8


class FakeGateway:
    def __init__(self, results: list[FakeModelResult | Exception]):
        self.results = results
        self.calls: list[dict] = []

    def complete(self, **request):
        self.calls.append(request)
        result = self.results.pop(0)
        if isinstance(result, Exception):
            raise result
        return result


def create_published_agent(
    client: TestClient,
    workspace_id: str,
    name: str = "Insight Agent",
) -> tuple[dict, dict]:
    agent = client.post(
        workspace_url(workspace_id, "/agents"),
        json={
            "name": name,
            "role": "Analyze the request and produce a concise answer.",
            "owner": "Platform Team",
            "model": "configured-model",
        },
        headers=csrf_headers(client),
    ).json()
    for asset_type, asset_name in (("tool", "Web Search"), ("skill", "Reasoning")):
        asset_response = client.post(
            workspace_url(workspace_id, "/asset-library"),
            json={
                "assetType": asset_type,
                "name": asset_name,
                "description": f"{asset_type} asset",
                "parameterSchema": {"type": "object"},
            },
            headers=csrf_headers(client),
        )
        assert asset_response.status_code == 201
    client.patch(
        workspace_url(workspace_id, f"/agents/{agent['id']}"),
        json={
            "systemPrompt": "Respond clearly and keep the answer actionable.",
            "tools": ["Web Search"],
            "skills": ["Reasoning"],
        },
        headers=csrf_headers(client),
    )
    version = client.post(
        workspace_url(workspace_id, f"/agents/{agent['id']}/publish"),
        headers=csrf_headers(client),
    ).json()
    return agent, version


def create_published_workflow(
    client: TestClient,
    workspace_id: str,
    agent: dict,
    version: dict,
    retry_max_attempts: int = 2,
) -> dict:
    workflow = client.post(
        workspace_url(workspace_id, "/workflows"),
        json={
            "name": "Execution Workflow",
            "nodes": [
                {"id": "start", "type": "trigger", "position": {"x": 0, "y": 0}, "data": {"label": "Start"}},
                {
                    "id": "agent",
                    "type": "agent",
                    "position": {"x": 200, "y": 0},
                    "data": {
                        "label": "Insight Agent",
                        "agentId": agent["id"],
                        "agentVersion": version["version"],
                        "retryMaxAttempts": retry_max_attempts,
                    },
                },
                {"id": "end", "type": "end", "position": {"x": 400, "y": 0}, "data": {"label": "End"}},
            ],
            "edges": [
                {"id": "start-agent", "source": "start", "target": "agent"},
                {"id": "agent-end", "source": "agent", "target": "end"},
            ],
        },
        headers=csrf_headers(client),
    ).json()
    publish_response = client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/publish"),
        headers=csrf_headers(client),
    )
    assert publish_response.status_code == 201
    return workflow


def make_queued_execution_job_claimable(client: TestClient) -> None:
    with client.app.state.session_factory() as session:
        job = session.scalar(select(ExecutionJobRecord))
        job.next_attempt_at = utc_now() - timedelta(seconds=1)
        session.commit()


def test_agent_test_run_records_model_usage_and_output(tmp_path):
    gateway = FakeGateway([FakeModelResult("This is a sufficiently long generated answer for the test run.")])
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'execution.db'}",
        model_gateway=gateway,
    )
    agent, version = create_published_agent(client, workspace_id)

    response = client.post(
        workspace_url(workspace_id, f"/agents/{agent['id']}/test-runs"),
        json={"input": "Summarize the customer issue.", "version": version["version"]},
        headers=csrf_headers(client),
    )

    assert response.status_code == 201
    run = response.json()
    assert run["status"] == "已完成"
    assert run["output"].startswith("This is a sufficiently long")
    assert run["model"] == "fake-model"
    assert run["totalTokens"] == 20
    assert run["score"] == 100
    assert gateway.calls[0]["system_prompt"].startswith("Respond clearly")


def test_agent_test_run_passes_published_runtime_config_to_gateway(tmp_path):
    gateway = FakeGateway([FakeModelResult("This is a configured runtime response for the test run.")])
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'execution.db'}",
        model_gateway=gateway,
    )
    agent, _ = create_published_agent(client, workspace_id)
    client.patch(
        workspace_url(workspace_id, f"/agents/{agent['id']}"),
        json={
            "model": "deepseek-v4-pro",
            "modelProvider": "openai-compatible",
            "modelBaseUrl": "https://api.deepseek.com",
            "temperature": 0.4,
            "maxOutputTokens": 1600,
        },
        headers=csrf_headers(client),
    )
    version = client.post(
        workspace_url(workspace_id, f"/agents/{agent['id']}/publish"),
        headers=csrf_headers(client),
    ).json()

    response = client.post(
        workspace_url(workspace_id, f"/agents/{agent['id']}/test-runs"),
        json={"input": "Summarize the customer issue.", "version": version["version"]},
        headers=csrf_headers(client),
    )

    assert response.status_code == 201
    assert gateway.calls[0]["system_prompt"].startswith("Respond clearly")
    assert gateway.calls[0]["user_input"].startswith("Summarize the customer issue.")
    assert gateway.calls[0]["model"] == "deepseek-v4-pro"
    assert gateway.calls[0]["model_provider_id"] is None
    assert gateway.calls[0]["model_provider"] == "openai-compatible"
    assert gateway.calls[0]["model_base_url"] == "https://api.deepseek.com"
    assert gateway.calls[0]["temperature"] == 0.4
    assert gateway.calls[0]["max_output_tokens"] == 1600


def test_agent_test_run_passes_bound_provider_secret_ref_label_to_gateway(tmp_path):
    gateway = FakeGateway([FakeModelResult("This is a provider secret ref runtime response.")])
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'execution.db'}",
        model_gateway=gateway,
    )
    provider = client.post(
        workspace_url(workspace_id, "/model-providers"),
        json={
            "name": "DeepSeek Runtime",
            "providerType": "openai-compatible",
            "baseUrl": "https://api.deepseek.com",
            "defaultModel": "deepseek-v4-pro",
            "secretRef": "DEEPSEEK_RUNTIME_KEY",
        },
        headers=csrf_headers(client),
    ).json()
    agent, _ = create_published_agent(client, workspace_id)
    client.patch(
        workspace_url(workspace_id, f"/agents/{agent['id']}"),
        json={"modelProviderId": provider["id"]},
        headers=csrf_headers(client),
    )
    version = client.post(
        workspace_url(workspace_id, f"/agents/{agent['id']}/publish"),
        headers=csrf_headers(client),
    ).json()

    response = client.post(
        workspace_url(workspace_id, f"/agents/{agent['id']}/test-runs"),
        json={"input": "Summarize the customer issue.", "version": version["version"]},
        headers=csrf_headers(client),
    )

    assert response.status_code == 201
    assert gateway.calls[0]["model_provider_id"] == provider["id"]
    assert gateway.calls[0]["model_secret_ref"] == "DEEPSEEK_RUNTIME_KEY"
    assert "apiKey" not in gateway.calls[0]
    assert "DEEPSEEK_RUNTIME_KEY" not in response.text


def test_workflow_run_retries_and_persists_node_timeline(tmp_path):
    gateway = FakeGateway([
        RuntimeError("temporary provider failure"),
        FakeModelResult("The workflow recovered on retry and completed successfully."),
    ])
    database_url = f"sqlite:///{tmp_path / 'execution.db'}"
    client, workspace_id = create_authenticated_client(database_url, model_gateway=gateway)
    agent, version = create_published_agent(client, workspace_id)
    workflow = create_published_workflow(client, workspace_id, agent, version)

    response = client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/runs"),
        json={"input": "Generate a polished final answer."},
        headers=csrf_headers(client),
    )

    assert response.status_code == 201
    run = response.json()
    assert run["status"] == "已完成"
    assert run["output"].startswith("The workflow recovered on retry")
    assert run["totalTokens"] == 20
    assert [node["status"] for node in run["nodes"]] == ["已完成", "已完成", "已完成"]
    assert run["nodes"][1]["attempts"] == 2

    restarted, restarted_workspace_id = create_authenticated_client(
        database_url,
        model_gateway=FakeGateway([]),
    )
    persisted = restarted.get(
        workspace_url(restarted_workspace_id, f"/runs/{run['id']}"),
    ).json()
    assert persisted["output"] == run["output"]
    assert len(persisted["nodes"]) == 3


def test_async_workflow_run_enqueues_and_worker_processes_next_job(tmp_path):
    gateway = FakeGateway([
        FakeModelResult("The queued workflow completed from the background worker."),
    ])
    database_url = f"sqlite:///{tmp_path / 'async-execution.db'}"
    client, workspace_id = create_authenticated_client(database_url, model_gateway=gateway)
    agent, version = create_published_agent(client, workspace_id)
    workflow = create_published_workflow(client, workspace_id, agent, version)

    response = client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/runs"),
        json={"input": "Run this workflow in the background.", "asyncMode": True},
        headers=csrf_headers(client),
    )

    assert response.status_code == 201
    queued_run = response.json()
    assert queued_run["status"] == "排队中"
    assert queued_run["nodes"] == []
    assert gateway.calls == []
    with client.app.state.session_factory() as session:
        job = session.scalar(select(ExecutionJobRecord))
        assert job is not None
        assert job.status == "queued"
        assert job.run_id == queued_run["id"]

    worker_response = client.post(
        workspace_url(workspace_id, "/execution-jobs/next"),
        headers=csrf_headers(client),
    )

    assert worker_response.status_code == 200
    processed_run = worker_response.json()
    assert processed_run["id"] == queued_run["id"]
    assert processed_run["status"] == "已完成"
    assert processed_run["output"].startswith("The queued workflow completed")
    assert len(processed_run["nodes"]) == 3
    assert len(gateway.calls) == 1
    with client.app.state.session_factory() as session:
        job = session.scalar(select(ExecutionJobRecord))
        assert job.status == "succeeded"


def test_async_execution_job_retries_failure_before_dead_letter(tmp_path):
    gateway = FakeGateway([
        RuntimeError("temporary outage"),
        RuntimeError("temporary outage"),
        FakeModelResult("The retry completed from the background worker."),
    ])
    database_url = f"sqlite:///{tmp_path / 'async-retry.db'}"
    client, workspace_id = create_authenticated_client(database_url, model_gateway=gateway)
    agent, version = create_published_agent(client, workspace_id)
    workflow = create_published_workflow(client, workspace_id, agent, version)

    response = client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/runs"),
        json={"input": "Retry this workflow in the background.", "asyncMode": True},
        headers=csrf_headers(client),
    )

    assert response.status_code == 201
    first_attempt = client.post(
        workspace_url(workspace_id, "/execution-jobs/next"),
        headers=csrf_headers(client),
    )

    assert first_attempt.status_code == 200
    assert first_attempt.json()["status"] == "排队中"
    with client.app.state.session_factory() as session:
        job = session.scalar(select(ExecutionJobRecord))
        assert job.status == "queued"
        assert job.attempts == 1
        assert job.error == "Agent 执行失败，请稍后重试"

    make_queued_execution_job_claimable(client)
    second_attempt = client.post(
        workspace_url(workspace_id, "/execution-jobs/next"),
        headers=csrf_headers(client),
    )

    assert second_attempt.status_code == 200
    assert second_attempt.json()["status"] == "已完成"
    assert second_attempt.json()["output"].startswith("The retry completed")
    with client.app.state.session_factory() as session:
        job = session.scalar(select(ExecutionJobRecord))
        assert job.status == "succeeded"
        assert job.attempts == 2


def test_async_execution_job_retry_uses_future_backoff_before_next_claim(tmp_path):
    gateway = FakeGateway([
        RuntimeError("temporary outage"),
        FakeModelResult("The retry completed after backoff."),
    ])
    database_url = f"sqlite:///{tmp_path / 'async-backoff.db'}"
    client, workspace_id = create_authenticated_client(database_url, model_gateway=gateway)
    agent, version = create_published_agent(client, workspace_id)
    workflow = create_published_workflow(
        client,
        workspace_id,
        agent,
        version,
        retry_max_attempts=1,
    )

    response = client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/runs"),
        json={"input": "Back off before retrying this workflow.", "asyncMode": True},
        headers=csrf_headers(client),
    )
    assert response.status_code == 201
    first_attempt = client.post(
        workspace_url(workspace_id, "/execution-jobs/next?workerId=worker-a"),
        headers=csrf_headers(client),
    )

    assert first_attempt.status_code == 200
    with client.app.state.session_factory() as session:
        job = session.scalar(select(ExecutionJobRecord))
        assert job.status == "queued"
        assert job.attempts == 1
        assert job.next_attempt_at is not None
        assert job.next_attempt_at > utc_now().replace(tzinfo=None)

    blocked_attempt = client.post(
        workspace_url(workspace_id, "/execution-jobs/next?workerId=worker-b"),
        headers=csrf_headers(client),
    )

    assert blocked_attempt.status_code == 404
    assert len(gateway.calls) == 1


def test_async_execution_job_moves_to_dead_letter_after_max_attempts(tmp_path):
    gateway = FakeGateway([
        RuntimeError("model unavailable"),
        RuntimeError("model unavailable"),
        RuntimeError("model unavailable"),
        RuntimeError("model unavailable"),
        RuntimeError("model unavailable"),
        RuntimeError("model unavailable"),
    ])
    database_url = f"sqlite:///{tmp_path / 'async-dead-letter.db'}"
    client, workspace_id = create_authenticated_client(database_url, model_gateway=gateway)
    agent, version = create_published_agent(client, workspace_id)
    workflow = create_published_workflow(client, workspace_id, agent, version)

    client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/runs"),
        json={"input": "Exhaust this workflow in the background.", "asyncMode": True},
        headers=csrf_headers(client),
    )

    for _ in range(3):
        make_queued_execution_job_claimable(client)
        response = client.post(
            workspace_url(workspace_id, "/execution-jobs/next"),
            headers=csrf_headers(client),
        )
        assert response.status_code == 200

    with client.app.state.session_factory() as session:
        job = session.scalar(select(ExecutionJobRecord))
        assert job.status == "dead_letter"
        assert job.attempts == 3
        assert job.error == "Agent 执行失败，请稍后重试"


def test_execution_job_lease_blocks_claim_until_expired(tmp_path):
    gateway = FakeGateway([
        FakeModelResult("The expired lease was recovered by another worker."),
    ])
    database_url = f"sqlite:///{tmp_path / 'async-lease.db'}"
    client, workspace_id = create_authenticated_client(database_url, model_gateway=gateway)
    agent, version = create_published_agent(client, workspace_id)
    workflow = create_published_workflow(client, workspace_id, agent, version)

    client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/runs"),
        json={"input": "Recover this leased workflow.", "asyncMode": True},
        headers=csrf_headers(client),
    )

    with client.app.state.session_factory() as session:
        job = session.scalar(select(ExecutionJobRecord))
        assert job is not None
        job.status = "running"
        job.locked_by = "worker-a"
        job.locked_until = utc_now() + timedelta(minutes=5)
        job.attempts = 1
        session.commit()

    blocked_response = client.post(
        workspace_url(workspace_id, "/execution-jobs/next?workerId=worker-b"),
        headers=csrf_headers(client),
    )

    assert blocked_response.status_code == 404
    assert gateway.calls == []

    with client.app.state.session_factory() as session:
        job = session.scalar(select(ExecutionJobRecord))
        job.locked_until = utc_now() - timedelta(seconds=1)
        session.commit()

    recovered_response = client.post(
        workspace_url(workspace_id, "/execution-jobs/next?workerId=worker-b"),
        headers=csrf_headers(client),
    )

    assert recovered_response.status_code == 200
    assert recovered_response.json()["status"] == "已完成"
    with client.app.state.session_factory() as session:
        job = session.scalar(select(ExecutionJobRecord))
        assert job.status == "succeeded"
        assert job.locked_by == "worker-b"
        assert job.attempts == 2


def test_execution_job_heartbeat_extends_active_lease(tmp_path):
    database_url = f"sqlite:///{tmp_path / 'async-heartbeat.db'}"
    client, workspace_id = create_authenticated_client(database_url)
    agent, version = create_published_agent(client, workspace_id)
    workflow = create_published_workflow(client, workspace_id, agent, version)

    client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/runs"),
        json={"input": "Keep this workflow lease alive.", "asyncMode": True},
        headers=csrf_headers(client),
    )
    with client.app.state.session_factory() as session:
        job = session.scalar(select(ExecutionJobRecord))
        job.status = "running"
        job.locked_by = "worker-a"
        job.locked_until = utc_now() + timedelta(seconds=1)
        session.commit()
        job_id = job.id

    heartbeat_response = client.post(
        workspace_url(workspace_id, f"/execution-jobs/{job_id}/heartbeat?workerId=worker-a"),
        headers=csrf_headers(client),
    )

    assert heartbeat_response.status_code == 200
    with client.app.state.session_factory() as session:
        job = session.scalar(select(ExecutionJobRecord))
        assert job.last_heartbeat_at is not None
        assert job.locked_until > utc_now().replace(tzinfo=None) + timedelta(minutes=4)


def test_execution_jobs_list_supports_status_filter_and_operational_fields(tmp_path):
    database_url = f"sqlite:///{tmp_path / 'async-jobs-list.db'}"
    client, workspace_id = create_authenticated_client(database_url)
    agent, version = create_published_agent(client, workspace_id)
    workflow = create_published_workflow(client, workspace_id, agent, version)

    client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/runs"),
        json={"input": "List this queue job.", "asyncMode": True},
        headers=csrf_headers(client),
    )
    with client.app.state.session_factory() as session:
        job = session.scalar(select(ExecutionJobRecord))
        job.status = "dead_letter"
        job.attempts = 3
        job.error = "Agent 执行失败，请稍后重试"
        job.locked_by = "worker-a"
        job.locked_until = utc_now() + timedelta(minutes=5)
        job.last_heartbeat_at = utc_now()
        job.dead_lettered_at = utc_now()
        session.commit()
        job_id = job.id

    queued_response = client.get(
        workspace_url(workspace_id, "/execution-jobs?status=queued"),
    )
    dead_letter_response = client.get(
        workspace_url(workspace_id, "/execution-jobs?status=dead_letter"),
    )

    assert queued_response.status_code == 200
    assert queued_response.json() == []
    assert dead_letter_response.status_code == 200
    jobs = dead_letter_response.json()
    assert len(jobs) == 1
    assert jobs[0]["id"] == job_id
    assert jobs[0]["runId"]
    assert jobs[0]["workflowId"] == workflow["id"]
    assert jobs[0]["status"] == "dead_letter"
    assert jobs[0]["attempts"] == 3
    assert jobs[0]["maxAttempts"] == 3
    assert jobs[0]["lockedBy"] == "worker-a"
    assert jobs[0]["lockedUntil"]
    assert jobs[0]["lastHeartbeatAt"]
    assert jobs[0]["deadLetteredAt"]
    assert jobs[0]["error"] == "Agent 执行失败，请稍后重试"


def test_dead_letter_execution_job_can_be_requeued(tmp_path):
    database_url = f"sqlite:///{tmp_path / 'async-requeue.db'}"
    client, workspace_id = create_authenticated_client(database_url)
    agent, version = create_published_agent(client, workspace_id)
    workflow = create_published_workflow(client, workspace_id, agent, version)

    run_response = client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/runs"),
        json={"input": "Requeue this dead letter workflow.", "asyncMode": True},
        headers=csrf_headers(client),
    )
    run_id = run_response.json()["id"]
    with client.app.state.session_factory() as session:
        job = session.scalar(select(ExecutionJobRecord))
        job.status = "dead_letter"
        job.attempts = 3
        job.error = "Agent 执行失败，请稍后重试"
        job.locked_by = "worker-a"
        job.locked_until = utc_now() + timedelta(minutes=5)
        job.last_heartbeat_at = utc_now()
        job.dead_lettered_at = utc_now()
        run = session.get(WorkflowRunRecord, run_id)
        run.status = "失败"
        run.error = job.error
        session.commit()
        job_id = job.id

    requeue_response = client.post(
        workspace_url(workspace_id, f"/execution-jobs/{job_id}/requeue"),
        json={"reason": "人工确认模型恢复，重新入队"},
        headers=csrf_headers(client),
    )

    assert requeue_response.status_code == 200
    requeued = requeue_response.json()
    assert requeued["status"] == "queued"
    assert requeued["attempts"] == 0
    assert requeued["error"] == ""
    assert requeued["lockedBy"] == ""
    assert requeued["lockedUntil"] is None
    assert requeued["deadLetteredAt"] is None
    with client.app.state.session_factory() as session:
        run = session.get(WorkflowRunRecord, run_id)
        assert run.status == "排队中"
        assert run.current_node == "等待重投"
        event = session.scalar(
            select(AuditEventRecord).where(
                AuditEventRecord.action == "execution_job.requeue",
                AuditEventRecord.target_id == job_id,
                AuditEventRecord.outcome == "success",
            ),
        )
        assert event is not None
        assert event.workspace_id == workspace_id
        assert event.target_type == "execution_job"
        assert event.before_status == "dead_letter"
        assert event.after_status == "queued"
        assert event.reason == "人工确认模型恢复，重新入队"
        assert event.payload["runId"] == run_id
        assert event.payload["attemptsBefore"] == 3
        assert event.payload["attemptsAfter"] == 0


def test_execution_job_can_be_canceled_before_worker_claims_it(tmp_path):
    gateway = FakeGateway([
        FakeModelResult("This should not run after cancellation."),
    ])
    database_url = f"sqlite:///{tmp_path / 'async-cancel.db'}"
    client, workspace_id = create_authenticated_client(database_url, model_gateway=gateway)
    agent, version = create_published_agent(client, workspace_id)
    workflow = create_published_workflow(client, workspace_id, agent, version)

    run_response = client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/runs"),
        json={"input": "Cancel this workflow before it runs.", "asyncMode": True},
        headers=csrf_headers(client),
    )
    run_id = run_response.json()["id"]
    with client.app.state.session_factory() as session:
        job = session.scalar(select(ExecutionJobRecord))
        job_id = job.id

    cancel_response = client.post(
        workspace_url(workspace_id, f"/execution-jobs/{job_id}/cancel"),
        json={"reason": "业务方取消本次运行"},
        headers=csrf_headers(client),
    )

    assert cancel_response.status_code == 200
    canceled = cancel_response.json()
    assert canceled["status"] == "canceled"
    assert canceled["error"] == "用户取消执行"
    assert canceled["lockedBy"] == ""
    assert canceled["lockedUntil"] is None
    assert canceled["canceledAt"]

    next_response = client.post(
        workspace_url(workspace_id, "/execution-jobs/next"),
        headers=csrf_headers(client),
    )

    assert next_response.status_code == 404
    assert gateway.calls == []
    with client.app.state.session_factory() as session:
        run = session.get(WorkflowRunRecord, run_id)
        assert run.status == "已取消"
        assert run.current_node == "已取消"
        event = session.scalar(
            select(AuditEventRecord).where(
                AuditEventRecord.action == "execution_job.cancel",
                AuditEventRecord.target_id == job_id,
                AuditEventRecord.outcome == "success",
            ),
        )
        assert event is not None
        assert event.workspace_id == workspace_id
        assert event.target_type == "execution_job"
        assert event.before_status == "queued"
        assert event.after_status == "canceled"
        assert event.reason == "业务方取消本次运行"
        assert event.payload["runId"] == run_id
        assert event.payload["attemptsBefore"] == 0


def test_execution_job_detail_includes_operation_audit_events(tmp_path):
    database_url = f"sqlite:///{tmp_path / 'async-job-detail.db'}"
    client, workspace_id = create_authenticated_client(database_url)
    agent, version = create_published_agent(client, workspace_id)
    workflow = create_published_workflow(client, workspace_id, agent, version)

    run_response = client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/runs"),
        json={"input": "Inspect this queued workflow.", "asyncMode": True},
        headers=csrf_headers(client),
    )
    run_id = run_response.json()["id"]
    with client.app.state.session_factory() as session:
        job = session.scalar(select(ExecutionJobRecord))
        job.status = "dead_letter"
        job.attempts = 3
        job.error = "Agent 执行失败，请稍后重试"
        job.dead_lettered_at = utc_now()
        run = session.get(WorkflowRunRecord, run_id)
        run.status = "失败"
        session.commit()
        job_id = job.id

    client.post(
        workspace_url(workspace_id, f"/execution-jobs/{job_id}/requeue"),
        json={"reason": "详情页验证重投审计"},
        headers=csrf_headers(client),
    )
    detail_response = client.get(
        workspace_url(workspace_id, f"/execution-jobs/{job_id}"),
    )

    assert detail_response.status_code == 200
    detail = detail_response.json()
    assert detail["id"] == job_id
    assert detail["runId"] == run_id
    assert detail["status"] == "queued"
    assert detail["auditEvents"][0]["action"] == "execution_job.requeue"
    assert detail["auditEvents"][0]["reason"] == "详情页验证重投审计"
    assert detail["auditEvents"][0]["beforeStatus"] == "dead_letter"
    assert detail["auditEvents"][0]["afterStatus"] == "queued"
    assert detail["auditEvents"][0]["payload"]["runId"] == run_id


def test_low_quality_output_creates_human_review(tmp_path):
    gateway = FakeGateway([FakeModelResult("short")])
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'execution.db'}",
        model_gateway=gateway,
    )
    agent, version = create_published_agent(client, workspace_id)
    workflow = create_published_workflow(client, workspace_id, agent, version)

    run = client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/runs"),
        json={"input": "Generate result"},
        headers=csrf_headers(client),
    ).json()
    reviews = client.get(workspace_url(workspace_id, "/reviews")).json()

    assert run["status"] == "需介入"
    assert run["score"] == 50
    assert len(reviews) == 1
    assert reviews[0]["runId"] == run["id"]
    assert reviews[0]["status"]


def test_agent_test_run_exhausts_retries_without_exposing_provider_error(tmp_path):
    gateway = FakeGateway([
        RuntimeError("provider-secret-detail"),
        RuntimeError("provider-secret-detail"),
    ])
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'execution.db'}",
        model_gateway=gateway,
    )
    agent, version = create_published_agent(client, workspace_id)

    response = client.post(
        workspace_url(workspace_id, f"/agents/{agent['id']}/test-runs"),
        json={"input": "Retry until the provider fails twice.", "version": version["version"]},
        headers=csrf_headers(client),
    )

    assert response.status_code == 201
    run = response.json()
    assert run["status"] == "失败"
    assert run["error"] == "Agent 执行失败，请稍后重试"
    assert run["nodes"][0]["status"] == "失败"
    assert run["nodes"][0]["attempts"] == 2
    assert run["nodes"][0]["error"] == "Agent 执行失败，请稍后重试"
    assert "provider-secret-detail" not in response.text


def test_human_review_decision_updates_review_and_run_status(tmp_path):
    gateway = FakeGateway([FakeModelResult("short")])
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'execution.db'}",
        model_gateway=gateway,
    )
    agent, version = create_published_agent(client, workspace_id)
    workflow = create_published_workflow(client, workspace_id, agent, version)
    run = client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/runs"),
        json={"input": "Produce a short answer that requires review."},
        headers=csrf_headers(client),
    ).json()
    review = client.get(workspace_url(workspace_id, "/reviews")).json()[0]

    response = client.post(
        workspace_url(workspace_id, f"/reviews/{review['id']}/decision"),
        json={"decision": "approve"},
        headers={**csrf_headers(client), "X-Request-ID": "req-review-approve"},
    )

    assert response.status_code == 200
    persisted = client.get(workspace_url(workspace_id, f"/runs/{run['id']}")).json()
    assert response.json()["status"] == persisted["status"]
    with client.app.state.session_factory() as session:
        event = session.scalars(
            select(AuditEventRecord)
            .where(
                AuditEventRecord.action == "review.decision",
                AuditEventRecord.target_id == review["id"],
                AuditEventRecord.outcome == "success",
            )
            .order_by(AuditEventRecord.created_at.desc()),
        ).first()
        assert event is not None
        assert event.workspace_id == workspace_id
        assert event.request_id == "req-review-approve"


def test_human_review_decision_reject_is_allowed_and_writes_success_audit(tmp_path):
    gateway = FakeGateway([FakeModelResult("short")])
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'execution-reject.db'}",
        model_gateway=gateway,
    )
    agent, version = create_published_agent(client, workspace_id)
    workflow = create_published_workflow(client, workspace_id, agent, version)
    client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/runs"),
        json={"input": "Produce a short answer that requires review."},
        headers=csrf_headers(client),
    )
    review = client.get(workspace_url(workspace_id, "/reviews")).json()[0]

    response = client.post(
        workspace_url(workspace_id, f"/reviews/{review['id']}/decision"),
        json={"decision": "reject"},
        headers={**csrf_headers(client), "X-Request-ID": "req-review-reject"},
    )

    assert response.status_code == 200
    with client.app.state.session_factory() as session:
        event = session.scalars(
            select(AuditEventRecord)
            .where(
                AuditEventRecord.action == "review.decision",
                AuditEventRecord.target_id == review["id"],
                AuditEventRecord.outcome == "success",
            )
            .order_by(AuditEventRecord.created_at.desc()),
        ).first()
        assert event is not None
        assert event.workspace_id == workspace_id
        assert event.request_id == "req-review-reject"


def test_human_review_decision_rejects_invalid_payload_without_changing_state(tmp_path):
    gateway = FakeGateway([FakeModelResult("short")])
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'execution-invalid-review.db'}",
        model_gateway=gateway,
    )
    agent, version = create_published_agent(client, workspace_id)
    workflow = create_published_workflow(client, workspace_id, agent, version)
    run = client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/runs"),
        json={"input": "Produce a short answer that requires review."},
        headers=csrf_headers(client),
    ).json()
    review = client.get(workspace_url(workspace_id, "/reviews")).json()[0]
    before_review_status = review["status"]
    before_run_status = client.get(workspace_url(workspace_id, f"/runs/{run['id']}")).json()["status"]

    response = client.post(
        workspace_url(workspace_id, f"/reviews/{review['id']}/decision"),
        json={"decision": "maybe"},
        headers=csrf_headers(client),
    )

    assert response.status_code == 422
    after_review_status = client.get(workspace_url(workspace_id, "/reviews")).json()[0]["status"]
    after_run_status = client.get(workspace_url(workspace_id, f"/runs/{run['id']}")).json()["status"]
    assert after_review_status == before_review_status
    assert after_run_status == before_run_status
