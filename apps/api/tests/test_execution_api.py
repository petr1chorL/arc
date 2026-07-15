from dataclasses import dataclass
from datetime import timedelta

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import func, select

from api_test_support import create_authenticated_client, csrf_headers, workspace_url
from app.agent_api_gateway import AgentApiGatewayError
from app.models import (
    ArtifactRecord,
    ArtifactVersionRecord,
    AuditEventRecord,
    EvaluationRecord,
    ExecutionJobRecord,
    NodeRunRecord,
    ToolSkillAssetInvocationRecord,
    WorkflowRunRecord,
    utc_now,
)
from app.tool_runtime import ToolRuntimeGatewayResult


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


@dataclass
class FakeAgentApiResult:
    output_text: str
    model: str = "remote-agent-model"
    prompt_tokens: int = 14
    completion_tokens: int = 9
    cost_usd: float = 0.006
    tool_calls: list[dict] | None = None


class FakeAgentApiGateway:
    def __init__(self, result: FakeAgentApiResult):
        self.result = result
        self.calls: list[dict] = []

    def execute(self, **request):
        self.calls.append(request)
        return self.result


class SequencedAgentApiGateway:
    def __init__(self, results: list[FakeAgentApiResult | Exception]):
        self.results = results
        self.calls: list[dict] = []

    def execute(self, **request):
        self.calls.append(request)
        result = self.results.pop(0)
        if isinstance(result, Exception):
            raise result
        return result


class SequencedHttpToolGateway:
    def __init__(self, results: list[ToolRuntimeGatewayResult | Exception]):
        self.results = results
        self.calls: list[dict] = []

    def execute(self, *, config: dict, parameters: dict) -> ToolRuntimeGatewayResult:
        self.calls.append({"config": config, "parameters": parameters})
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


def test_remote_agent_api_test_run_persists_remote_result_without_model_call(tmp_path):
    model_gateway = FakeGateway([])
    agent_api_gateway = FakeAgentApiGateway(FakeAgentApiResult(
        output_text="Remote Agent returned a persisted actionable result.",
        tool_calls=[],
    ))
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'remote-agent-execution.db'}",
        model_gateway=model_gateway,
        agent_api_gateway=agent_api_gateway,
    )
    agent = client.post(
        workspace_url(workspace_id, "/agents"),
        json={
            "name": "Remote Insight Agent",
            "role": "Call a remote Agent service.",
            "owner": "Platform Team",
            "model": "remote-managed",
        },
        headers=csrf_headers(client),
    ).json()
    manifest = {
        "runtime": "remote_http",
        "sourceType": "remote_api",
        "protocolVersion": "arc-agent-v1",
        "endpointUrl": "https://agent.example.com/v1/invoke",
        "secretRef": "REMOTE_AGENT_API_TOKEN",
        "timeoutSeconds": 30,
    }
    update_response = client.patch(
        workspace_url(workspace_id, f"/agents/{agent['id']}"),
        json={
            "systemPrompt": "Return an actionable result.",
            "runtimeManifest": manifest,
        },
        headers=csrf_headers(client),
    )
    assert update_response.status_code == 200
    version = client.post(
        workspace_url(workspace_id, f"/agents/{agent['id']}/publish"),
        headers=csrf_headers(client),
    ).json()

    response = client.post(
        workspace_url(workspace_id, f"/agents/{agent['id']}/test-runs"),
        json={"input": "Analyze this request.", "version": version["version"]},
        headers=csrf_headers(client),
    )

    assert response.status_code == 201
    run = response.json()
    assert run["status"] == "已完成"
    assert run["output"] == "Remote Agent returned a persisted actionable result."
    assert run["model"] == "remote-agent-model"
    assert run["promptTokens"] == 14
    assert run["completionTokens"] == 9
    assert run["costUsd"] == 0.006
    assert model_gateway.calls == []
    assert len(agent_api_gateway.calls) == 1
    call = agent_api_gateway.calls[0]
    assert call["endpoint_url"] == manifest["endpointUrl"]
    assert call["secret_ref"] == manifest["secretRef"]
    assert call["timeout_seconds"] == 30
    assert call["run_id"] == run["id"]
    assert call["node_run_id"]
    assert call["invocation_id"]


def test_remote_agent_api_runs_as_workflow_node_and_persists_artifact(tmp_path):
    model_gateway = FakeGateway([])
    agent_api_gateway = FakeAgentApiGateway(FakeAgentApiResult(
        output_text="Remote workflow Agent produced a downstream artifact.",
        tool_calls=[],
    ))
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'remote-agent-workflow.db'}",
        model_gateway=model_gateway,
        agent_api_gateway=agent_api_gateway,
    )
    agent, _ = create_published_agent(client, workspace_id, name="Remote Workflow Agent")
    manifest = {
        "runtime": "remote_http",
        "sourceType": "remote_api",
        "protocolVersion": "arc-agent-v1",
        "endpointUrl": "https://agent.example.com/v1/invoke",
        "secretRef": "REMOTE_AGENT_API_TOKEN",
        "timeoutSeconds": 30,
    }
    update_response = client.patch(
        workspace_url(workspace_id, f"/agents/{agent['id']}"),
        json={"runtimeManifest": manifest},
        headers=csrf_headers(client),
    )
    assert update_response.status_code == 200
    version = client.post(
        workspace_url(workspace_id, f"/agents/{agent['id']}/publish"),
        headers=csrf_headers(client),
    ).json()
    workflow = create_published_workflow(client, workspace_id, agent, version)

    response = client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/runs"),
        json={"input": "Analyze this workflow request."},
        headers=csrf_headers(client),
    )

    assert response.status_code == 201
    run = response.json()
    assert run["status"] == "已完成"
    agent_node_run = next(node for node in run["nodes"] if node["nodeType"] == "agent")
    assert agent_node_run["output"] == "Remote workflow Agent produced a downstream artifact."
    artifacts_response = client.get(
        workspace_url(
            workspace_id,
            f"/artifacts?runId={run['id']}&sourceNodeRunId={agent_node_run['id']}",
        ),
    )
    assert artifacts_response.status_code == 200
    artifacts = artifacts_response.json()
    assert len(artifacts) == 1
    assert artifacts[0]["content"] == "Remote workflow Agent produced a downstream artifact."
    assert len(agent_api_gateway.calls) == 1
    assert model_gateway.calls == []


def test_execution_service_rejects_agent_version_from_another_workspace(tmp_path):
    gateway = FakeGateway([FakeModelResult("This must never execute.")])
    client, source_workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'execution-cross-workspace-agent.db'}",
        model_gateway=gateway,
    )
    agent, version = create_published_agent(client, source_workspace_id)
    target_workspace_response = client.post(
        "/api/workspaces",
        json={"name": "Runtime Target Workspace", "slug": "runtime-target-workspace"},
        headers=csrf_headers(client),
    )
    assert target_workspace_response.status_code == 201
    target_workspace_id = target_workspace_response.json()["id"]

    with client.app.state.session_factory() as session:
        run = WorkflowRunRecord(
            workspace_id=target_workspace_id,
            kind="workflow",
            name="Cross Workspace Runtime",
            input_text="Do not execute the foreign Agent.",
        )
        session.add(run)
        session.flush()

        with pytest.raises(RuntimeError, match="Agent 版本 .* 不存在"):
            client.app.state.execution_service.execute_agent(
                session=session,
                run=run,
                node_id="foreign-agent",
                node_name="Foreign Agent",
                input_text=run.input_text,
                agent_id=agent["id"],
                agent_version=version["version"],
            )

    assert gateway.calls == []


def create_published_workflow(
    client: TestClient,
    workspace_id: str,
    agent: dict,
    version: dict,
    retry_max_attempts: int = 2,
    input_schema: dict | None = None,
    output_data_object_ref: dict | None = None,
) -> dict:
    agent_data = {
        "label": "Insight Agent",
        "agentId": agent["id"],
        "agentVersion": version["version"],
        "retryMaxAttempts": retry_max_attempts,
    }
    if output_data_object_ref is not None:
        agent_data["outputDataObjectRef"] = output_data_object_ref
    payload = {
        "name": "Execution Workflow",
        "nodes": [
            {"id": "start", "type": "trigger", "position": {"x": 0, "y": 0}, "data": {"label": "Start"}},
            {
                "id": "agent",
                "type": "agent",
                "position": {"x": 200, "y": 0},
                "data": agent_data,
            },
            {"id": "end", "type": "end", "position": {"x": 400, "y": 0}, "data": {"label": "End"}},
        ],
        "edges": [
            {"id": "start-agent", "source": "start", "target": "agent"},
            {"id": "agent-end", "source": "agent", "target": "end"},
        ],
    }
    if input_schema is not None:
        payload["inputSchema"] = input_schema
    workflow = client.post(
        workspace_url(workspace_id, "/workflows"),
        json=payload,
        headers=csrf_headers(client),
    ).json()
    publish_response = client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/publish"),
        headers=csrf_headers(client),
    )
    assert publish_response.status_code == 201
    return workflow


def create_published_linear_agent_workflow(
    client: TestClient,
    workspace_id: str,
    agent: dict,
    versions: list[dict],
) -> dict:
    agent_nodes = [
        {
            "id": f"agent-{index}",
            "type": "agent",
            "position": {"x": index * 200, "y": 0},
            "data": {
                "label": f"Agent {index}",
                "agentId": agent["id"],
                "agentVersion": version["version"],
                "retryMaxAttempts": 1,
            },
        }
        for index, version in enumerate(versions, start=1)
    ]
    node_ids = ["start", *(node["id"] for node in agent_nodes), "end"]
    payload = {
        "name": "Linear Agent Workflow",
        "nodes": [
            {
                "id": "start",
                "type": "trigger",
                "position": {"x": 0, "y": 0},
                "data": {"label": "Start"},
            },
            *agent_nodes,
            {
                "id": "end",
                "type": "end",
                "position": {"x": (len(versions) + 1) * 200, "y": 0},
                "data": {"label": "End"},
            },
        ],
        "edges": [
            {"id": f"{source}-{target}", "source": source, "target": target}
            for source, target in zip(node_ids, node_ids[1:])
        ],
    }
    workflow = client.post(
        workspace_url(workspace_id, "/workflows"),
        json=payload,
        headers=csrf_headers(client),
    ).json()
    publish_response = client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/publish"),
        headers=csrf_headers(client),
    )
    assert publish_response.status_code == 201
    return workflow


def create_published_data_object(client: TestClient, workspace_id: str) -> tuple[dict, dict]:
    definition = client.post(
        workspace_url(workspace_id, "/data-objects"),
        json={
            "name": "Structured Insight",
            "description": "Final structured workflow output.",
            "schema": {
                "type": "object",
                "required": ["summary"],
                "properties": {"summary": {"type": "string"}},
            },
        },
        headers=csrf_headers(client),
    ).json()
    version = client.post(
        workspace_url(workspace_id, f"/data-objects/{definition['id']}/publish"),
        headers=csrf_headers(client),
    ).json()
    return definition, version


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


def test_agent_test_run_uses_published_provider_secret_ref_snapshot(tmp_path):
    gateway = FakeGateway([FakeModelResult("Frozen Provider snapshot response.")])
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'execution-provider-snapshot.db'}",
        model_gateway=gateway,
    )
    provider = client.post(
        workspace_url(workspace_id, "/model-providers"),
        json={
            "name": "DeepSeek Snapshot",
            "providerType": "openai-compatible",
            "baseUrl": "https://api.deepseek.com",
            "defaultModel": "deepseek-v4-pro",
            "secretRef": "DEEPSEEK_PUBLISHED_KEY",
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
    client.patch(
        workspace_url(workspace_id, f"/model-providers/{provider['id']}"),
        json={"secretRef": "DEEPSEEK_ROTATED_KEY"},
        headers=csrf_headers(client),
    )
    client.post(
        workspace_url(workspace_id, f"/model-providers/{provider['id']}/deactivate"),
        headers=csrf_headers(client),
    )

    response = client.post(
        workspace_url(workspace_id, f"/agents/{agent['id']}/test-runs"),
        json={"input": "Use the frozen Provider snapshot.", "version": version["version"]},
        headers=csrf_headers(client),
    )

    assert response.status_code == 201
    assert version["snapshot"]["modelSecretRef"] == "DEEPSEEK_PUBLISHED_KEY"
    assert gateway.calls[0]["model_provider_id"] == provider["id"]
    assert gateway.calls[0]["model_secret_ref"] == "DEEPSEEK_PUBLISHED_KEY"
    assert "DEEPSEEK_ROTATED_KEY" not in response.text
    assert "apiKey" not in gateway.calls[0]


def test_agent_run_cannot_bind_an_inline_provider_secret(tmp_path):
    gateway = FakeGateway([FakeModelResult("This must never execute.")])
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'execution-inline-provider.db'}",
        model_gateway=gateway,
    )
    submitted_value = "inline-secret-value"
    provider_response = client.post(
        workspace_url(workspace_id, "/model-providers"),
        json={
            "name": "DeepSeek Inline Runtime",
            "providerType": "openai-compatible",
            "baseUrl": "https://api.deepseek.com",
            "defaultModel": "deepseek-v4-pro",
            "secretRef": submitted_value,
        },
        headers=csrf_headers(client),
    )

    assert provider_response.status_code == 422
    assert provider_response.json() == {"detail": "Secret Ref 只能填写后端环境变量名"}
    assert submitted_value not in provider_response.text
    assert gateway.calls == []


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
    with restarted.app.state.session_factory() as session:
        artifact = session.scalar(
            select(ArtifactRecord).where(ArtifactRecord.run_id == run["id"]),
        )
        assert artifact is not None
        artifact_version = session.scalar(
            select(ArtifactVersionRecord).where(
                ArtifactVersionRecord.artifact_id == artifact.id,
            ),
        )
        assert artifact_version is not None
        assert artifact_version.data_object_definition_id is None
        assert artifact_version.data_object_version_id is None
        assert artifact_version.data_object_snapshot is None


def test_workflow_blank_agent_output_fails_without_downstream_or_review_artifacts(tmp_path):
    gateway = FakeGateway([
        FakeModelResult(""),
        FakeModelResult("   \n"),
    ])
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'blank-agent-output.db'}",
        model_gateway=gateway,
    )
    agent, version = create_published_agent(client, workspace_id)
    workflow = create_published_workflow(client, workspace_id, agent, version)

    response = client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/runs"),
        json={"input": "This input must not be reused as an Agent output."},
        headers=csrf_headers(client),
    )

    assert response.status_code == 201
    run = response.json()
    assert run["status"] == "失败"
    assert run["output"] == ""
    assert run["error"] == "模型未返回有效内容，Agent 执行失败，请稍后重试"
    assert [node["nodeId"] for node in run["nodes"]] == ["start", "agent"]
    assert run["nodes"][1]["status"] == "失败"
    assert run["nodes"][1]["attempts"] == 2
    assert run["nodes"][1]["output"] == ""
    assert client.get(workspace_url(workspace_id, f"/artifacts?runId={run['id']}")).json() == []
    assert client.get(workspace_url(workspace_id, "/reviews")).json() == []
    assert len(gateway.calls) == 2


def test_workflow_run_records_artifact_for_each_node_output(tmp_path):
    gateway = FakeGateway([
        FakeModelResult("Weather answer: It's always sunny in Shanghai."),
    ])
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'node-output-artifacts.db'}",
        model_gateway=gateway,
    )
    agent, version = create_published_agent(client, workspace_id, name="Weather Agent")
    workflow = create_published_workflow(client, workspace_id, agent, version)

    response = client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/runs"),
        json={"input": "What is the weather in Shanghai?"},
        headers=csrf_headers(client),
    )

    assert response.status_code == 201
    run = response.json()
    agent_node_run = next(node for node in run["nodes"] if node["nodeType"] == "agent")
    artifacts_response = client.get(
        workspace_url(
            workspace_id,
            f"/artifacts?runId={run['id']}&sourceNodeRunId={agent_node_run['id']}",
        ),
    )

    assert artifacts_response.status_code == 200
    artifacts = artifacts_response.json()
    assert len(artifacts) == 1
    assert artifacts[0]["content"] == "Weather answer: It's always sunny in Shanghai."


def test_workflow_run_final_artifact_version_records_output_data_object_contract(tmp_path):
    gateway = FakeGateway([
        FakeModelResult('{"summary":"The workflow produced structured output."}'),
    ])
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'artifact-data-object-contract.db'}",
        model_gateway=gateway,
    )
    agent, version = create_published_agent(client, workspace_id)
    definition, data_object_version = create_published_data_object(client, workspace_id)
    workflow = create_published_workflow(
        client,
        workspace_id,
        agent,
        version,
        output_data_object_ref={
            "definitionId": definition["id"],
            "name": definition["name"],
            "version": data_object_version["version"],
            "status": "published",
            "schemaSummary": "required: summary",
        },
    )

    response = client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/runs"),
        json={"input": "Generate a structured insight."},
        headers=csrf_headers(client),
    )

    assert response.status_code == 201
    run = response.json()
    final_node_run = run["nodes"][-1]
    with client.app.state.session_factory() as session:
        artifact = session.scalar(
            select(ArtifactRecord).where(
                ArtifactRecord.workspace_id == workspace_id,
                ArtifactRecord.run_id == run["id"],
                ArtifactRecord.source_node_run_id == final_node_run["id"],
            ),
        )
        assert artifact is not None
        artifact_version = session.scalar(
            select(ArtifactVersionRecord).where(
                ArtifactVersionRecord.workspace_id == workspace_id,
                ArtifactVersionRecord.artifact_id == artifact.id,
            ),
        )
        assert artifact_version is not None
        assert artifact_version.data_object_definition_id == definition["id"]
        assert artifact_version.data_object_version_id == data_object_version["id"]
        assert artifact_version.data_object_snapshot["name"] == "Structured Insight"
        assert artifact_version.data_object_snapshot["schema"]["required"] == ["summary"]


def test_artifact_catalog_lists_versions_with_data_object_filter(tmp_path):
    gateway = FakeGateway([
        FakeModelResult('{"summary":"Catalog visible structured output."}'),
    ])
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'artifact-catalog.db'}",
        model_gateway=gateway,
    )
    agent, version = create_published_agent(client, workspace_id)
    definition, data_object_version = create_published_data_object(client, workspace_id)
    workflow = create_published_workflow(
        client,
        workspace_id,
        agent,
        version,
        output_data_object_ref={
            "definitionId": definition["id"],
            "name": definition["name"],
            "version": data_object_version["version"],
            "status": "published",
            "schemaSummary": "required: summary",
        },
    )
    run = client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/runs"),
        json={"input": "Generate a cataloged artifact."},
        headers=csrf_headers(client),
    ).json()

    response = client.get(
        workspace_url(
            workspace_id,
            f"/artifacts?dataObjectDefinitionId={definition['id']}",
        ),
    )

    assert response.status_code == 200
    artifacts = response.json()
    assert len(artifacts) == 1
    assert artifacts[0]["runId"] == run["id"]
    assert artifacts[0]["content"] == '{"summary":"Catalog visible structured output."}'
    assert artifacts[0]["dataObjectDefinitionId"] == definition["id"]
    assert artifacts[0]["dataObjectVersionId"] == data_object_version["id"]
    assert artifacts[0]["dataObjectSnapshot"]["schema"]["required"] == ["summary"]
    assert artifacts[0]["schemaValidation"]["status"] == "passed"
    assert artifacts[0]["schemaValidation"]["label"] == "Schema 校验通过"
    assert artifacts[0]["schemaValidation"]["reasons"] == []
    with client.app.state.session_factory() as session:
        run_record = session.scalar(
            select(WorkflowRunRecord).where(WorkflowRunRecord.id == run["id"]),
        )
        source_node = session.scalar(
            select(NodeRunRecord).where(NodeRunRecord.id == artifacts[0]["sourceNodeRunId"]),
        )
        assert run_record is not None
        assert source_node is not None
        assert artifacts[0]["workflowName"] == run_record.name
        assert artifacts[0]["runStatus"] == run_record.status
        assert artifacts[0]["sourceNodeName"] == source_node.node_name
        assert artifacts[0]["sourceNodeType"] == source_node.node_type
        assert artifacts[0]["sourceNodeStatus"] == source_node.status
        assert artifacts[0]["sourceNodeDurationMs"] == source_node.duration_ms
        assert artifacts[0]["sourceNodeScore"] == source_node.score

    with client.app.state.session_factory() as session:
        broken_artifact = ArtifactRecord(
            workspace_id=workspace_id,
            run_id=run["id"],
            source_node_run_id="node-run-broken",
            content='{"title":"Missing summary."}',
            score=61,
        )
        session.add(broken_artifact)
        session.flush()
        session.add(ArtifactVersionRecord(
            workspace_id=workspace_id,
            artifact_id=broken_artifact.id,
            version=1,
            content='{"title":"Missing summary."}',
            data_object_definition_id=definition["id"],
            data_object_version_id=data_object_version["id"],
            data_object_snapshot=data_object_version["snapshot"],
            created_by="user-1",
        ))
        session.commit()

    failed_response = client.get(workspace_url(workspace_id, "/artifacts"))

    assert failed_response.status_code == 200
    failed_artifact = next(
        artifact
        for artifact in failed_response.json()
        if artifact["sourceNodeRunId"] == "node-run-broken"
    )
    assert failed_artifact["schemaValidation"]["status"] == "failed"
    assert failed_artifact["schemaValidation"]["label"] == "Schema 校验失败"
    assert failed_artifact["schemaValidation"]["reasons"] == ["缺少必填字段：summary"]
    assert failed_artifact["workflowName"] == run["name"]
    assert failed_artifact["runStatus"] == run["status"]
    assert failed_artifact["sourceNodeName"] is None
    assert failed_artifact["sourceNodeType"] is None
    assert failed_artifact["sourceNodeStatus"] is None
    assert failed_artifact["sourceNodeDurationMs"] is None
    assert failed_artifact["sourceNodeScore"] is None

    failed_filter_response = client.get(
        workspace_url(
            workspace_id,
            f"/artifacts?dataObjectDefinitionId={definition['id']}&schemaValidationStatus=failed",
        ),
    )

    assert failed_filter_response.status_code == 200
    failed_filtered_artifacts = failed_filter_response.json()
    assert len(failed_filtered_artifacts) == 1
    assert failed_filtered_artifacts[0]["sourceNodeRunId"] == "node-run-broken"
    assert failed_filtered_artifacts[0]["schemaValidation"]["status"] == "failed"

    node_run_filter_response = client.get(
        workspace_url(
            workspace_id,
            f"/artifacts?runId={run['id']}&sourceNodeRunId=node-run-broken",
        ),
    )

    assert node_run_filter_response.status_code == 200
    node_run_artifacts = node_run_filter_response.json()
    assert len(node_run_artifacts) == 1
    assert node_run_artifacts[0]["runId"] == run["id"]
    assert node_run_artifacts[0]["sourceNodeRunId"] == "node-run-broken"

    empty_response = client.get(
        workspace_url(
            workspace_id,
            "/artifacts?dataObjectDefinitionId=missing-definition",
        ),
    )

    assert empty_response.status_code == 200
    assert empty_response.json() == []

    other_workspace = client.post(
        "/api/workspaces",
        json={"name": "Artifact Empty Workspace", "slug": "artifact-empty-workspace"},
        headers=csrf_headers(client),
    )
    assert other_workspace.status_code == 201
    other_workspace_artifacts = client.get(
        workspace_url(other_workspace.json()["id"], "/artifacts"),
    )

    assert other_workspace_artifacts.status_code == 200
    assert other_workspace_artifacts.json() == []


def test_workflow_run_rejects_input_missing_required_schema_field(tmp_path):
    gateway = FakeGateway([
        FakeModelResult("This should not be called for invalid schema input."),
    ])
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'schema-run-validation.db'}",
        model_gateway=gateway,
    )
    agent, version = create_published_agent(client, workspace_id)
    workflow = create_published_workflow(
        client,
        workspace_id,
        agent,
        version,
        input_schema={
            "type": "object",
            "required": ["asin"],
            "properties": {
                "asin": {"type": "string"},
                "score": {"type": "number"},
            },
        },
    )

    response = client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/runs"),
        json={"input": '{"score":91}'},
        headers=csrf_headers(client),
    )

    assert response.status_code == 422
    assert "asin" in response.text
    assert gateway.calls == []
    with client.app.state.session_factory() as session:
        runs = session.scalars(select(WorkflowRunRecord)).all()
        assert runs == []


def test_workflow_run_rejects_input_with_schema_type_mismatch(tmp_path):
    gateway = FakeGateway([
        FakeModelResult("This should not be called when schema types fail."),
    ])
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'schema-run-type-validation.db'}",
        model_gateway=gateway,
    )
    agent, version = create_published_agent(client, workspace_id)
    workflow = create_published_workflow(
        client,
        workspace_id,
        agent,
        version,
        input_schema={
            "type": "object",
            "required": ["asin"],
            "properties": {
                "asin": {"type": "string"},
                "score": {"type": "number"},
                "urgent": {"type": "boolean"},
            },
        },
    )

    response = client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/runs"),
        json={"input": '{"asin":"B0TEST","score":"91","urgent":"yes"}'},
        headers=csrf_headers(client),
    )

    assert response.status_code == 422
    assert "score" in response.text
    assert "urgent" in response.text
    assert gateway.calls == []
    with client.app.state.session_factory() as session:
        runs = session.scalars(select(WorkflowRunRecord)).all()
        assert runs == []


def test_workflow_run_accepts_valid_schema_input(tmp_path):
    gateway = FakeGateway([
        FakeModelResult("The schema-valid workflow input reached the agent."),
    ])
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'schema-run-valid.db'}",
        model_gateway=gateway,
    )
    agent, version = create_published_agent(client, workspace_id)
    workflow = create_published_workflow(
        client,
        workspace_id,
        agent,
        version,
        input_schema={
            "type": "object",
            "required": ["asin", "score", "urgent"],
            "properties": {
                "asin": {"type": "string"},
                "score": {"type": "number"},
                "urgent": {"type": "boolean"},
            },
        },
    )

    response = client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/runs"),
        json={"input": '{"asin":"B0TEST","score":91,"urgent":true}'},
        headers=csrf_headers(client),
    )

    assert response.status_code == 201
    assert gateway.calls[0]["user_input"] == '{"asin":"B0TEST","score":91,"urgent":true}'


def test_workflow_run_keeps_free_text_for_unsupported_schema(tmp_path):
    gateway = FakeGateway([
        FakeModelResult("The legacy free-text input still reached the agent."),
    ])
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'schema-run-unsupported.db'}",
        model_gateway=gateway,
    )
    agent, version = create_published_agent(client, workspace_id)
    workflow = create_published_workflow(
        client,
        workspace_id,
        agent,
        version,
        input_schema={
            "type": "object",
            "required": ["tags"],
            "properties": {
                "tags": {"type": "array", "items": {"type": "string"}},
            },
        },
    )

    response = client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/runs"),
        json={"input": "legacy free text input"},
        headers=csrf_headers(client),
    )

    assert response.status_code == 201
    assert gateway.calls[0]["user_input"] == "legacy free text input"


def test_workflow_edge_mapping_builds_downstream_agent_input(tmp_path):
    gateway = FakeGateway([
        FakeModelResult("The mapped workflow input reached the agent."),
    ])
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'mapped-execution.db'}",
        model_gateway=gateway,
    )
    agent, version = create_published_agent(client, workspace_id)
    workflow = client.post(
        workspace_url(workspace_id, "/workflows"),
        json={
            "name": "Mapped Execution Workflow",
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
                    },
                },
                {"id": "end", "type": "end", "position": {"x": 400, "y": 0}, "data": {"label": "End"}},
            ],
            "edges": [
                {
                    "id": "start-agent",
                    "source": "start",
                    "target": "agent",
                    "data": {
                        "mappings": [
                            {"sourcePath": "$.asin", "targetPath": "$.input.asin"},
                            {"sourcePath": "$.market", "targetPath": "$.input.market"},
                        ],
                    },
                },
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

    response = client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/runs"),
        json={"input": '{"asin":"B0TEST","market":"US","ignored":"value"}'},
        headers=csrf_headers(client),
    )

    assert response.status_code == 201
    assert gateway.calls[0]["user_input"] == '{"input":{"asin":"B0TEST","market":"US"}}'
    agent_node = next(node for node in response.json()["nodes"] if node["nodeId"] == "agent")
    assert agent_node["input"] == '{"input":{"asin":"B0TEST","market":"US"}}'


def test_workflow_edge_mapping_falls_back_when_source_is_not_mappable(tmp_path):
    gateway = FakeGateway([
        FakeModelResult("The fallback workflow input reached the agent."),
    ])
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'mapped-fallback.db'}",
        model_gateway=gateway,
    )
    agent, version = create_published_agent(client, workspace_id)
    workflow = client.post(
        workspace_url(workspace_id, "/workflows"),
        json={
            "name": "Mapped Fallback Workflow",
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
                    },
                },
                {"id": "end", "type": "end", "position": {"x": 400, "y": 0}, "data": {"label": "End"}},
            ],
            "edges": [
                {
                    "id": "start-agent",
                    "source": "start",
                    "target": "agent",
                    "data": {
                        "mappings": [
                            {"sourcePath": "$.missing", "targetPath": "$.input.asin"},
                        ],
                    },
                },
                {"id": "agent-end", "source": "agent", "target": "end"},
            ],
        },
        headers=csrf_headers(client),
    ).json()
    client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/publish"),
        headers=csrf_headers(client),
    )

    response = client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/runs"),
        json={"input": "plain text that cannot map"},
        headers=csrf_headers(client),
    )

    assert response.status_code == 201
    assert gateway.calls[0]["user_input"] == "plain text that cannot map"
    agent_node = next(node for node in response.json()["nodes"] if node["nodeId"] == "agent")
    assert agent_node["input"] == "plain text that cannot map"


def test_workflow_without_edge_mapping_keeps_original_agent_input(tmp_path):
    gateway = FakeGateway([
        FakeModelResult("The unmapped workflow input reached the agent."),
    ])
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'unmapped-execution.db'}",
        model_gateway=gateway,
    )
    agent, version = create_published_agent(client, workspace_id)
    workflow = create_published_workflow(client, workspace_id, agent, version)

    response = client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/runs"),
        json={"input": "Keep the legacy workflow input."},
        headers=csrf_headers(client),
    )

    assert response.status_code == 201
    assert gateway.calls[0]["user_input"] == "Keep the legacy workflow input."
    agent_node = next(node for node in response.json()["nodes"] if node["nodeId"] == "agent")
    assert agent_node["input"] == "Keep the legacy workflow input."


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
    assert [
        node["nodeId"] for node in second_attempt.json()["nodes"]
    ] == ["start", "agent", "agent", "end"]
    with client.app.state.session_factory() as session:
        job = session.scalar(select(ExecutionJobRecord))
        assert job.status == "succeeded"
        assert job.attempts == 2


def test_remote_agent_async_retry_reuses_the_complete_idempotent_request(tmp_path):
    upstream_output = "The first upstream result must stay frozen across queue retries."
    model_gateway = FakeGateway([FakeModelResult(upstream_output)])
    agent_api_gateway = SequencedAgentApiGateway([
        AgentApiGatewayError("temporary remote outage", retryable=True),
        FakeAgentApiResult(output_text="Remote retry completed with one logical invocation."),
    ])
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'remote-async-retry.db'}",
        model_gateway=model_gateway,
        agent_api_gateway=agent_api_gateway,
    )
    agent, built_in_version = create_published_agent(
        client,
        workspace_id,
        name="Remote Retry Agent",
    )
    manifest = {
        "runtime": "remote_http",
        "sourceType": "remote_api",
        "protocolVersion": "arc-agent-v1",
        "endpointUrl": "https://agent.example.com/v1/invoke",
        "secretRef": "REMOTE_AGENT_API_TOKEN",
        "timeoutSeconds": 30,
    }
    update_response = client.patch(
        workspace_url(workspace_id, f"/agents/{agent['id']}"),
        json={"runtimeManifest": manifest},
        headers=csrf_headers(client),
    )
    assert update_response.status_code == 200
    remote_version = client.post(
        workspace_url(workspace_id, f"/agents/{agent['id']}/publish"),
        headers=csrf_headers(client),
    ).json()
    workflow = create_published_linear_agent_workflow(
        client,
        workspace_id,
        agent,
        [built_in_version, remote_version],
    )
    queue_response = client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/runs"),
        json={"input": "Retry one logical remote invocation.", "asyncMode": True},
        headers=csrf_headers(client),
    )
    assert queue_response.status_code == 201

    first_attempt = client.post(
        workspace_url(workspace_id, "/execution-jobs/next"),
        headers=csrf_headers(client),
    )
    assert first_attempt.status_code == 200
    assert first_attempt.json()["status"] == "排队中"
    make_queued_execution_job_claimable(client)

    second_attempt = client.post(
        workspace_url(workspace_id, "/execution-jobs/next"),
        headers=csrf_headers(client),
    )
    assert second_attempt.status_code == 200
    assert second_attempt.json()["status"] == "已完成"
    assert len(agent_api_gateway.calls) == 2
    assert agent_api_gateway.calls[0] == agent_api_gateway.calls[1]
    assert agent_api_gateway.calls[0]["input_text"] == upstream_output
    assert len(model_gateway.calls) == 1
    assert [
        node["nodeId"] for node in second_attempt.json()["nodes"]
    ] == ["start", "agent-1", "agent-2", "agent-2", "end"]


def test_remote_agent_async_retry_reuses_frozen_http_tool_result(tmp_path):
    tool_gateway = SequencedHttpToolGateway([
        ToolRuntimeGatewayResult(output_summary="tool-result-A"),
        ToolRuntimeGatewayResult(output_summary="tool-result-B"),
    ])
    agent_api_gateway = SequencedAgentApiGateway([
        AgentApiGatewayError("temporary remote outage", retryable=True),
        FakeAgentApiResult(output_text="Remote retry reused the frozen tool result."),
    ])
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'remote-tool-async-retry.db'}",
        model_gateway=FakeGateway([]),
        agent_api_gateway=agent_api_gateway,
        tool_gateway=tool_gateway,
    )
    persisted_before_send: list[tuple[str, str] | None] = []

    def inspecting_execute(**request):
        with client.app.state.session_factory() as session:
            persisted = session.scalar(
                select(NodeRunRecord)
                .where(
                    NodeRunRecord.run_id == request["run_id"],
                    NodeRunRecord.node_id == request["node_id"],
                )
                .order_by(NodeRunRecord.started_at.desc()),
            )
            persisted_before_send.append(
                None if persisted is None else (persisted.status, persisted.input_text),
            )
        agent_api_gateway.calls.append(request)
        result = agent_api_gateway.results.pop(0)
        if isinstance(result, Exception):
            raise result
        return result

    agent_api_gateway.execute = inspecting_execute
    tool_response = client.post(
        workspace_url(workspace_id, "/asset-library"),
        json={
            "assetType": "tool",
            "name": "Remote Evidence",
            "description": "Fetch evidence before the remote Agent call.",
            "parameterSchema": {"type": "object"},
            "adapterType": "http",
            "adapterConfig": {
                "method": "POST",
                "url": "https://internal.example.test/evidence",
            },
        },
        headers=csrf_headers(client),
    )
    assert tool_response.status_code == 201
    agent = client.post(
        workspace_url(workspace_id, "/agents"),
        json={
            "name": "Remote Tool Agent",
            "role": "Use frozen tool evidence.",
            "owner": "Platform Team",
            "model": "remote-managed",
        },
        headers=csrf_headers(client),
    ).json()
    manifest = {
        "runtime": "remote_http",
        "sourceType": "remote_api",
        "protocolVersion": "arc-agent-v1",
        "endpointUrl": "https://agent.example.com/v1/invoke",
        "secretRef": "REMOTE_AGENT_API_TOKEN",
        "timeoutSeconds": 30,
    }
    update_response = client.patch(
        workspace_url(workspace_id, f"/agents/{agent['id']}"),
        json={
            "systemPrompt": "Use the fetched evidence.",
            "tools": ["Remote Evidence"],
            "runtimeManifest": manifest,
        },
        headers=csrf_headers(client),
    )
    assert update_response.status_code == 200
    version = client.post(
        workspace_url(workspace_id, f"/agents/{agent['id']}/publish"),
        headers=csrf_headers(client),
    ).json()
    workflow = create_published_workflow(
        client,
        workspace_id,
        agent,
        version,
        retry_max_attempts=1,
    )
    queue_response = client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/runs"),
        json={"input": "Use one frozen tool result.", "asyncMode": True},
        headers=csrf_headers(client),
    )
    assert queue_response.status_code == 201

    first_attempt = client.post(
        workspace_url(workspace_id, "/execution-jobs/next"),
        headers=csrf_headers(client),
    )
    assert first_attempt.status_code == 200
    assert first_attempt.json()["status"] == "排队中"
    make_queued_execution_job_claimable(client)
    second_attempt = client.post(
        workspace_url(workspace_id, "/execution-jobs/next"),
        headers=csrf_headers(client),
    )

    assert second_attempt.status_code == 200
    assert second_attempt.json()["status"] == "已完成"
    assert len(tool_gateway.calls) == 1
    assert len(agent_api_gateway.calls) == 2
    assert agent_api_gateway.calls[0] == agent_api_gateway.calls[1]
    assert persisted_before_send[0] is not None
    assert persisted_before_send[0][0] == "运行中"
    assert "tool-result-A" in persisted_before_send[0][1]
    assert "tool-result-A" in agent_api_gateway.calls[0]["input_text"]
    assert "tool-result-B" not in agent_api_gateway.calls[0]["input_text"]
    with client.app.state.session_factory() as session:
        invocation_count = session.scalar(
            select(func.count())
            .select_from(ToolSkillAssetInvocationRecord)
            .where(ToolSkillAssetInvocationRecord.run_id == queue_response.json()["id"]),
        )
        assert invocation_count == 1


def test_remote_agent_usage_respects_remaining_run_integer_budget(tmp_path):
    agent_api_gateway = FakeAgentApiGateway(FakeAgentApiResult(
        output_text="Remote Agent returned a result with very large reported usage.",
        prompt_tokens=1_500_000_000,
        completion_tokens=0,
    ))
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'remote-agent-run-usage-budget.db'}",
        model_gateway=FakeGateway([]),
        agent_api_gateway=agent_api_gateway,
    )
    agent, _ = create_published_agent(
        client,
        workspace_id,
        name="Remote Usage Budget Agent",
    )
    manifest = {
        "runtime": "remote_http",
        "sourceType": "remote_api",
        "protocolVersion": "arc-agent-v1",
        "endpointUrl": "https://agent.example.com/v1/invoke",
        "secretRef": "REMOTE_AGENT_API_TOKEN",
        "timeoutSeconds": 30,
    }
    update_response = client.patch(
        workspace_url(workspace_id, f"/agents/{agent['id']}"),
        json={"runtimeManifest": manifest},
        headers=csrf_headers(client),
    )
    assert update_response.status_code == 200
    remote_version = client.post(
        workspace_url(workspace_id, f"/agents/{agent['id']}/publish"),
        headers=csrf_headers(client),
    ).json()
    workflow = create_published_linear_agent_workflow(
        client,
        workspace_id,
        agent,
        [remote_version, remote_version],
    )

    response = client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/runs"),
        json={"input": "Keep aggregate token usage inside the database limit."},
        headers=csrf_headers(client),
    )

    assert response.status_code == 201
    run = response.json()
    assert run["status"] == "失败"
    assert run["totalTokens"] == 1_500_000_000
    assert [node["nodeId"] for node in run["nodes"]] == [
        "start",
        "agent-1",
        "agent-2",
    ]
    assert run["nodes"][-1]["status"] == "失败"
    assert len(agent_api_gateway.calls) == 2
    assert agent_api_gateway.calls[0]["max_total_tokens"] == 2_147_483_647
    assert agent_api_gateway.calls[1]["max_total_tokens"] == 647_483_647


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


def test_failed_workflow_run_can_be_rerun_with_original_input_and_version(tmp_path):
    gateway = FakeGateway([
        RuntimeError("provider-secret-detail"),
        RuntimeError("provider-secret-detail"),
        FakeModelResult("The rerun completed with the original workflow input."),
    ])
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'execution.db'}",
        model_gateway=gateway,
    )
    agent, version = create_published_agent(client, workspace_id)
    workflow = create_published_workflow(client, workspace_id, agent, version)

    source = client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/runs"),
        json={"input": "Retry this workflow from the run center."},
        headers=csrf_headers(client),
    ).json()
    assert source["status"] == "失败"

    response = client.post(
        workspace_url(workspace_id, f"/runs/{source['id']}/rerun"),
        headers={**csrf_headers(client), "X-Request-ID": "req-run-rerun"},
    )

    assert response.status_code == 201
    rerun = response.json()
    assert rerun["id"] != source["id"]
    assert rerun["workflowId"] == workflow["id"]
    assert rerun["workflowVersion"] == source["workflowVersion"]
    assert rerun["input"] == source["input"]
    assert rerun["status"] == "已完成"
    assert rerun["output"].startswith("The rerun completed")

    with client.app.state.session_factory() as session:
        event = session.scalars(
            select(AuditEventRecord)
            .where(
                AuditEventRecord.action == "run.rerun",
                AuditEventRecord.target_id == source["id"],
                AuditEventRecord.outcome == "success",
            )
            .order_by(AuditEventRecord.created_at.desc()),
        ).first()
        assert event is not None
        assert event.workspace_id == workspace_id
        assert event.request_id == "req-run-rerun"
        assert event.event_metadata["sourceRunId"] == source["id"]
        assert event.event_metadata["newRunId"] == rerun["id"]


def test_failed_workflow_run_can_be_rerun_with_overridden_input(tmp_path):
    gateway = FakeGateway([
        RuntimeError("provider-secret-detail"),
        RuntimeError("provider-secret-detail"),
        FakeModelResult("The rerun completed with an overridden workflow input."),
    ])
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'execution.db'}",
        model_gateway=gateway,
    )
    agent, version = create_published_agent(client, workspace_id)
    workflow = create_published_workflow(client, workspace_id, agent, version)
    source = client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/runs"),
        json={"input": "Original failed workflow input."},
        headers=csrf_headers(client),
    ).json()

    response = client.post(
        workspace_url(workspace_id, f"/runs/{source['id']}/rerun"),
        json={"input": "Corrected workflow input for rerun."},
        headers={**csrf_headers(client), "X-Request-ID": "req-run-rerun-override"},
    )

    assert response.status_code == 201
    rerun = response.json()
    assert rerun["id"] != source["id"]
    assert rerun["input"] == "Corrected workflow input for rerun."
    assert rerun["workflowId"] == workflow["id"]
    assert rerun["workflowVersion"] == source["workflowVersion"]
    assert gateway.calls[-1]["user_input"] == "Corrected workflow input for rerun."

    with client.app.state.session_factory() as session:
        event = session.scalars(
            select(AuditEventRecord)
            .where(
                AuditEventRecord.action == "run.rerun",
                AuditEventRecord.target_id == source["id"],
                AuditEventRecord.outcome == "success",
            )
            .order_by(AuditEventRecord.created_at.desc()),
        ).first()
        assert event is not None
        assert event.request_id == "req-run-rerun-override"
        assert event.event_metadata["inputOverridden"] is True


def test_workflow_rerun_rejects_blank_overridden_input(tmp_path):
    gateway = FakeGateway([
        RuntimeError("provider-secret-detail"),
        RuntimeError("provider-secret-detail"),
    ])
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'execution.db'}",
        model_gateway=gateway,
    )
    agent, version = create_published_agent(client, workspace_id)
    workflow = create_published_workflow(client, workspace_id, agent, version)
    source = client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/runs"),
        json={"input": "Original failed workflow input."},
        headers=csrf_headers(client),
    ).json()

    response = client.post(
        workspace_url(workspace_id, f"/runs/{source['id']}/rerun"),
        json={"input": "   "},
        headers=csrf_headers(client),
    )

    assert response.status_code == 422


def test_agent_run_cannot_be_rerun_from_workflow_history_endpoint(tmp_path):
    gateway = FakeGateway([FakeModelResult("This direct agent run should not be rerun as a workflow.")])
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'execution.db'}",
        model_gateway=gateway,
    )
    agent, version = create_published_agent(client, workspace_id)
    source = client.post(
        workspace_url(workspace_id, f"/agents/{agent['id']}/test-runs"),
        json={"input": "Run the agent directly.", "version": version["version"]},
        headers=csrf_headers(client),
    ).json()

    response = client.post(
        workspace_url(workspace_id, f"/runs/{source['id']}/rerun"),
        headers=csrf_headers(client),
    )

    assert response.status_code == 422


def test_workflow_runs_can_be_batch_rerun_with_per_item_failures(tmp_path):
    gateway = FakeGateway([
        RuntimeError("first-provider-outage"),
        RuntimeError("first-provider-outage"),
        RuntimeError("second-provider-outage"),
        RuntimeError("second-provider-outage"),
        FakeModelResult("Agent run created only as an invalid batch source."),
        FakeModelResult("First batch rerun completed."),
        FakeModelResult("Second batch rerun completed."),
    ])
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'execution.db'}",
        model_gateway=gateway,
    )
    agent, version = create_published_agent(client, workspace_id)
    workflow = create_published_workflow(client, workspace_id, agent, version)
    first_source = client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/runs"),
        json={"input": "First failed input"},
        headers=csrf_headers(client),
    ).json()
    second_source = client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/runs"),
        json={"input": "Second failed input"},
        headers=csrf_headers(client),
    ).json()
    agent_source = client.post(
        workspace_url(workspace_id, f"/agents/{agent['id']}/test-runs"),
        json={"input": "Agent run cannot be batch rerun", "version": version["version"]},
        headers=csrf_headers(client),
    ).json()

    response = client.post(
        workspace_url(workspace_id, "/runs/batch-rerun"),
        json={"runIds": [first_source["id"], agent_source["id"], second_source["id"]]},
        headers={
            **csrf_headers(client),
            "x-request-id": "req-run-batch-rerun",
        },
    )

    assert response.status_code == 201
    payload = response.json()
    assert [run["input"] for run in payload["createdRuns"]] == [
        "First failed input",
        "Second failed input",
    ]
    assert [run["output"] for run in payload["createdRuns"]] == [
        "First batch rerun completed.",
        "Second batch rerun completed.",
    ]
    assert payload["failures"] == [
        {
            "sourceRunId": agent_source["id"],
            "reason": "仅支持 Workflow Run 批量重跑",
        },
    ]
    assert gateway.calls[-2]["user_input"] == "First failed input"
    assert gateway.calls[-1]["user_input"] == "Second failed input"
    with client.app.state.session_factory() as session:
        events = list(session.scalars(
            select(AuditEventRecord)
            .where(AuditEventRecord.action == "run.batch_rerun")
            .order_by(AuditEventRecord.created_at.asc()),
        ))
        assert len(events) == 2
        assert [event.event_metadata["sourceRunId"] for event in events] == [
            first_source["id"],
            second_source["id"],
        ]
        assert [event.event_metadata["newRunId"] for event in events] == [
            payload["createdRuns"][0]["id"],
            payload["createdRuns"][1]["id"],
        ]
        assert all(event.request_id == "req-run-batch-rerun" for event in events)


def test_failed_workflow_run_can_resume_from_failed_node(tmp_path):
    gateway = FakeGateway([
        RuntimeError("temporary-provider-outage"),
        FakeModelResult("The failed node recovered and downstream execution completed."),
    ])
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'execution.db'}",
        model_gateway=gateway,
    )
    agent, version = create_published_agent(client, workspace_id)
    workflow = create_published_workflow(client, workspace_id, agent, version, retry_max_attempts=1)
    source = client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/runs"),
        json={"input": "Resume this failed node without replaying the start node."},
        headers=csrf_headers(client),
    ).json()
    assert source["status"] == "失败"
    assert [node["nodeId"] for node in source["nodes"]] == ["start", "agent"]

    response = client.post(
        workspace_url(workspace_id, f"/runs/{source['id']}/resume-from-failed-node"),
        headers={**csrf_headers(client), "X-Request-ID": "req-run-resume-failed-node"},
    )

    assert response.status_code == 200
    resumed = response.json()
    assert resumed["id"] == source["id"]
    assert resumed["status"] == "已完成"
    assert resumed["output"].startswith("The failed node recovered")
    assert [node["nodeId"] for node in resumed["nodes"]] == ["start", "agent", "agent", "end"]
    assert resumed["nodes"][1]["status"] == "失败"
    assert resumed["nodes"][2]["status"] == "已完成"

    with client.app.state.session_factory() as session:
        event = session.scalars(
            select(AuditEventRecord)
            .where(
                AuditEventRecord.action == "run.resume_failed_node",
                AuditEventRecord.target_id == source["id"],
                AuditEventRecord.outcome == "success",
            )
            .order_by(AuditEventRecord.created_at.desc()),
        ).first()
        assert event is not None
        assert event.request_id == "req-run-resume-failed-node"
        assert event.event_metadata["runId"] == source["id"]
        assert event.event_metadata["failedNodeId"] == "agent"


def test_workflow_runs_can_batch_resume_from_failed_nodes_with_per_item_failures(tmp_path):
    gateway = FakeGateway([
        RuntimeError("first-provider-outage"),
        RuntimeError("second-provider-outage"),
        FakeModelResult("This workflow already completed."),
        FakeModelResult("First batch resume recovered."),
        FakeModelResult("Second batch resume recovered."),
    ])
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'execution.db'}",
        model_gateway=gateway,
    )
    agent, version = create_published_agent(client, workspace_id)
    workflow = create_published_workflow(client, workspace_id, agent, version, retry_max_attempts=1)
    first_source = client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/runs"),
        json={"input": "First batch resume input"},
        headers=csrf_headers(client),
    ).json()
    second_source = client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/runs"),
        json={"input": "Second batch resume input"},
        headers=csrf_headers(client),
    ).json()
    completed_source = client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/runs"),
        json={"input": "Completed source cannot be resumed"},
        headers=csrf_headers(client),
    ).json()

    response = client.post(
        workspace_url(workspace_id, "/runs/batch-resume-from-failed-node"),
        json={"runIds": [first_source["id"], completed_source["id"], second_source["id"]]},
        headers={
            **csrf_headers(client),
            "x-request-id": "req-run-batch-resume",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert [run["id"] for run in payload["resumedRuns"]] == [
        first_source["id"],
        second_source["id"],
    ]
    assert [run["output"] for run in payload["resumedRuns"]] == [
        "First batch resume recovered.",
        "Second batch resume recovered.",
    ]
    assert payload["failures"] == [
        {
            "sourceRunId": completed_source["id"],
            "reason": "Run has no resumable failed node",
        },
    ]
    assert [node["nodeId"] for node in payload["resumedRuns"][0]["nodes"]] == [
        "start",
        "agent",
        "agent",
        "end",
    ]
    with client.app.state.session_factory() as session:
        events = list(session.scalars(
            select(AuditEventRecord)
            .where(AuditEventRecord.action == "run.batch_resume_failed_node")
            .order_by(AuditEventRecord.created_at.asc()),
        ))
        assert len(events) == 2
        assert [event.event_metadata["runId"] for event in events] == [
            first_source["id"],
            second_source["id"],
        ]
        assert [event.event_metadata["failedNodeId"] for event in events] == ["agent", "agent"]
        assert all(event.request_id == "req-run-batch-resume" for event in events)


def test_run_operation_history_lists_related_run_audit_events(tmp_path):
    gateway = FakeGateway([FakeModelResult("The run completed before operation history events.")])
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'execution.db'}",
        model_gateway=gateway,
    )
    agent, version = create_published_agent(client, workspace_id)
    workflow = create_published_workflow(client, workspace_id, agent, version)
    source = client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/runs"),
        json={"input": "Create a run with operation history."},
        headers=csrf_headers(client),
    ).json()
    created_at = utc_now()

    with client.app.state.session_factory() as session:
        session.add_all([
            AuditEventRecord(
                workspace_id=workspace_id,
                action="run.rerun",
                target_type="run",
                target_id=source["id"],
                outcome="success",
                request_id="req-single-rerun",
                event_metadata={"sourceRunId": source["id"], "newRunId": "new-single-run"},
                reason="single rerun",
                created_at=created_at,
            ),
            AuditEventRecord(
                workspace_id=workspace_id,
                action="run.batch_rerun",
                target_type="run",
                target_id="other-source-run",
                outcome="success",
                request_id="req-batch-rerun",
                event_metadata={"sourceRunId": source["id"], "newRunId": "new-batch-run"},
                reason="batch rerun",
                created_at=created_at + timedelta(seconds=1),
            ),
            AuditEventRecord(
                workspace_id=workspace_id,
                action="run.batch_resume_failed_node",
                target_type="run",
                target_id="other-resume-run",
                outcome="success",
                request_id="req-batch-resume",
                trace_id="trace-batch-resume",
                event_metadata={"runId": source["id"], "failedNodeId": "agent"},
                reason="batch resume",
                created_at=created_at + timedelta(seconds=2),
            ),
            AuditEventRecord(
                workspace_id=workspace_id,
                action="agent.publish",
                target_type="agent",
                target_id=agent["id"],
                outcome="success",
                request_id="req-unrelated",
                event_metadata={"runId": source["id"]},
                created_at=created_at + timedelta(seconds=3),
            ),
        ])
        session.commit()

    response = client.get(
        workspace_url(workspace_id, f"/runs/{source['id']}/operation-history"),
    )

    assert response.status_code == 200
    events = response.json()
    assert [event["action"] for event in events] == [
        "run.batch_resume_failed_node",
        "run.batch_rerun",
        "run.rerun",
    ]
    assert events[0]["requestId"] == "req-batch-resume"
    assert events[0]["traceId"] == "trace-batch-resume"
    assert events[0]["metadata"]["runId"] == source["id"]
    assert events[1]["metadata"]["sourceRunId"] == source["id"]
    assert events[2]["targetId"] == source["id"]


def test_failed_workflow_run_with_unknown_status_and_error_can_resume(tmp_path):
    gateway = FakeGateway([
        RuntimeError("temporary-provider-outage"),
        FakeModelResult("The unknown-status failed node recovered."),
    ])
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'execution.db'}",
        model_gateway=gateway,
    )
    agent, version = create_published_agent(client, workspace_id)
    workflow = create_published_workflow(client, workspace_id, agent, version, retry_max_attempts=1)
    source = client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/runs"),
        json={"input": "Resume a browser-compatible failed node."},
        headers=csrf_headers(client),
    ).json()
    with client.app.state.session_factory() as session:
        failed_node = session.scalar(
            select(NodeRunRecord).where(
                NodeRunRecord.run_id == source["id"],
                NodeRunRecord.node_id == "agent",
            ),
        )
        assert failed_node is not None
        failed_node.status = "??"
        session.commit()

    response = client.post(
        workspace_url(workspace_id, f"/runs/{source['id']}/resume-from-failed-node"),
        headers=csrf_headers(client),
    )

    assert response.status_code == 200
    resumed = response.json()
    assert resumed["id"] == source["id"]
    assert resumed["output"].startswith("The unknown-status failed node recovered")
    assert [node["nodeId"] for node in resumed["nodes"]] == ["start", "agent", "agent", "end"]
    assert resumed["nodes"][1]["status"] == "??"


def test_completed_workflow_run_cannot_resume_without_failed_node(tmp_path):
    gateway = FakeGateway([FakeModelResult("This workflow completed before resume was requested.")])
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'execution.db'}",
        model_gateway=gateway,
    )
    agent, version = create_published_agent(client, workspace_id)
    workflow = create_published_workflow(client, workspace_id, agent, version, retry_max_attempts=1)
    source = client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/runs"),
        json={"input": "This run succeeds."},
        headers=csrf_headers(client),
    ).json()
    assert source["status"] == "已完成"

    response = client.post(
        workspace_url(workspace_id, f"/runs/{source['id']}/resume-from-failed-node"),
        headers=csrf_headers(client),
    )

    assert response.status_code == 409


def test_workflow_run_can_be_deleted_without_deleting_workflow_asset(tmp_path):
    gateway = FakeGateway([FakeModelResult("This workflow run can be deleted after completion.")])
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'execution-delete-run.db'}",
        model_gateway=gateway,
    )
    agent, version = create_published_agent(client, workspace_id)
    workflow = create_published_workflow(client, workspace_id, agent, version)
    run = client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/runs"),
        json={"input": "Create a run that will be deleted."},
        headers=csrf_headers(client),
    ).json()

    response = client.delete(
        workspace_url(workspace_id, f"/runs/{run['id']}"),
        headers=csrf_headers(client),
    )

    assert response.status_code == 204
    runs = client.get(workspace_url(workspace_id, "/runs")).json()
    assert all(item["id"] != run["id"] for item in runs)
    assert client.get(workspace_url(workspace_id, f"/runs/{run['id']}")).status_code == 404
    assert client.get(workspace_url(workspace_id, f"/workflows/{workflow['id']}")).status_code == 200

    with client.app.state.session_factory() as session:
        assert session.scalar(select(WorkflowRunRecord).where(WorkflowRunRecord.id == run["id"])) is None
        assert session.scalar(select(NodeRunRecord).where(NodeRunRecord.run_id == run["id"])) is None


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

def test_async_worker_rolls_back_dirty_attempt_before_retry(tmp_path, monkeypatch):
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'async-dirty-attempt.db'}",
        model_gateway=FakeGateway([]),
    )
    agent, version = create_published_agent(client, workspace_id)
    workflow = create_published_workflow(client, workspace_id, agent, version)
    queued = client.post(
        workspace_url(workspace_id, f"/workflows/{workflow['id']}/runs"),
        json={"input": "Run dirty attempt.", "asyncMode": True},
        headers=csrf_headers(client),
    ).json()

    def dirty_attempt(**kwargs):
        session = kwargs["session"]
        run = kwargs["run"]
        partial_node = NodeRunRecord(
            workspace_id=workspace_id,
            run_id=run.id,
            node_id="evaluation",
            node_type="evaluation",
            node_name="Evaluation",
            status="运行中",
            input_text="partial",
            output_text="partial",
        )
        session.add(partial_node)
        session.flush()
        session.add(EvaluationRecord(
            workspace_id=workspace_id,
            rubric_id="partial-rubric",
            rubric_version="v1.0.0",
            rubric_snapshot={},
            subject_type="node_run",
            subject_id=partial_node.id,
            artifact_text="partial",
            dimension_scores=[],
            score=0,
            status="failed",
            rationale="partial",
            created_by="system",
        ))
        session.flush()
        raise RuntimeError("unexpected failure after flush")

    monkeypatch.setattr(
        client.app.state.execution_service,
        "execute_workflow_from",
        dirty_attempt,
    )

    response = client.post(
        workspace_url(workspace_id, "/execution-jobs/next"),
        headers=csrf_headers(client),
    )

    assert response.status_code == 200
    assert response.json()["id"] == queued["id"]
    assert response.json()["status"] == "排队中"
    with client.app.state.session_factory() as session:
        job = session.scalar(select(ExecutionJobRecord))
        assert job is not None
        assert job.status == "queued"
        assert job.attempts == 1
        assert job.error == "后台执行失败，请稍后重试"
        assert session.scalar(select(func.count()).select_from(NodeRunRecord)) == 0
        assert session.scalar(select(func.count()).select_from(EvaluationRecord)) == 0
        assert session.scalar(select(func.count()).select_from(ArtifactRecord)) == 0


def test_finish_run_does_not_create_artifact_for_failed_node_with_output(tmp_path):
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'failed-output-artifact.db'}",
        model_gateway=FakeGateway([]),
    )
    with client.app.state.session_factory() as session:
        run = WorkflowRunRecord(
            workspace_id=workspace_id,
            kind="workflow",
            name="Failed evaluation",
            status="运行中",
            input_text="input",
        )
        session.add(run)
        session.flush()
        node_run = NodeRunRecord(
            workspace_id=workspace_id,
            run_id=run.id,
            node_id="evaluation",
            node_type="evaluation",
            node_name="Evaluation",
            status="失败",
            input_text="input",
            output_text="partial evaluation",
            error="failed",
        )
        session.add(node_run)
        session.flush()

        client.app.state.execution_service.finish_run(
            session,
            run,
            [node_run],
            0.0,
        )

        assert run.status == "失败"
        assert session.scalar(
            select(func.count())
            .select_from(ArtifactRecord)
            .where(ArtifactRecord.source_node_run_id == node_run.id),
        ) == 0
