from dataclasses import dataclass

import pytest
import httpx
from sqlalchemy import select

from api_test_support import create_authenticated_client, csrf_headers, workspace_url
from app.config import Settings
from app.models import AgentVersionRecord
from app.tool_runtime import HttpxToolGateway, ToolRuntimeGatewayError, ToolRuntimeGatewayResult


@dataclass
class FakeModelResult:
    content: str
    model: str = "fake-model"
    prompt_tokens: int = 12
    completion_tokens: int = 8


class FakeModelGateway:
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
class FakeHttpToolGateway:
    results: list[ToolRuntimeGatewayResult | Exception]

    def __post_init__(self):
        self.calls: list[dict] = []

    def execute(self, *, config: dict, parameters: dict) -> ToolRuntimeGatewayResult:
        self.calls.append({"config": config, "parameters": parameters})
        result = self.results.pop(0)
        if isinstance(result, Exception):
            raise result
        return result


def create_http_tool(client, workspace_id: str, *, name: str = "价格查询") -> dict:
    response = client.post(
        workspace_url(workspace_id, "/asset-library"),
        json={
            "assetType": "tool",
            "name": name,
            "description": "Query price data",
            "parameterSchema": {
                "type": "object",
                "properties": {"sku": {"type": "string"}},
                "required": ["sku"],
            },
            "adapterType": "http",
            "adapterConfig": {
                "method": "POST",
                "url": "https://internal.example.test/price",
            },
        },
        headers=csrf_headers(client),
    )
    assert response.status_code == 201
    return response.json()


def create_mcp_tool(client, workspace_id: str, *, name: str = "飞书文档读取") -> dict:
    response = client.post(
        workspace_url(workspace_id, "/asset-library"),
        json={
            "assetType": "tool",
            "name": name,
            "description": "Read docs through MCP",
            "parameterSchema": {
                "type": "object",
                "properties": {"docToken": {"type": "string"}},
                "required": ["docToken"],
            },
            "adapterType": "mcp",
            "adapterConfig": {
                "server": "lark-doc",
                "tool": "get_doc",
            },
        },
        headers=csrf_headers(client),
    )
    assert response.status_code == 201
    return response.json()


def create_agent_bound_to_tool(
    client,
    workspace_id: str,
    *,
    tool_name: str,
) -> tuple[dict, dict]:
    agent = client.post(
        workspace_url(workspace_id, "/agents"),
        json={
            "name": "工具调用 Agent",
            "role": "Use available tools before answering.",
            "owner": "Platform Team",
            "model": "configured-model",
        },
        headers=csrf_headers(client),
    ).json()
    update = client.patch(
        workspace_url(workspace_id, f"/agents/{agent['id']}"),
        json={
            "systemPrompt": "Call the configured tool and answer with evidence.",
            "tools": [tool_name],
        },
        headers=csrf_headers(client),
    )
    assert update.status_code == 200
    version = client.post(
        workspace_url(workspace_id, f"/agents/{agent['id']}/publish"),
        headers=csrf_headers(client),
    )
    assert version.status_code == 201
    return agent, version.json()


def test_http_tool_test_invocation_writes_success_log(tmp_path):
    gateway = FakeHttpToolGateway([
        ToolRuntimeGatewayResult(output_summary="price=199", raw_output={"price": 199}),
    ])
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'http-tool-runtime.db'}",
        tool_gateway=gateway,
    )
    tool = create_http_tool(client, workspace_id)

    response = client.post(
        workspace_url(workspace_id, f"/asset-library/{tool['id']}/test-invocations"),
        json={"parameters": {"sku": "A001"}},
        headers=csrf_headers(client),
    )
    logs = client.get(
        workspace_url(workspace_id, f"/asset-library/invocations?assetId={tool['id']}"),
    ).json()

    assert response.status_code == 201
    assert response.json()["status"] == "succeeded"
    assert response.json()["outputSummary"] == "price=199"
    assert logs[0]["id"] == response.json()["id"]
    assert logs[0]["inputSummary"] == '{"sku": "A001"}'
    assert gateway.calls == [{
        "config": {"method": "POST", "url": "https://internal.example.test/price"},
        "parameters": {"sku": "A001"},
    }]


def test_http_tool_test_invocation_writes_sanitized_failure_log(tmp_path):
    gateway = FakeHttpToolGateway([
        ToolRuntimeGatewayError("provider-secret-detail"),
    ])
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'http-tool-runtime-failure.db'}",
        tool_gateway=gateway,
    )
    tool = create_http_tool(client, workspace_id)

    response = client.post(
        workspace_url(workspace_id, f"/asset-library/{tool['id']}/test-invocations"),
        json={"parameters": {"sku": "A001"}},
        headers=csrf_headers(client),
    )

    assert response.status_code == 201
    assert response.json()["status"] == "failed"
    assert response.json()["error"] == "工具执行失败，请稍后重试"
    assert "provider-secret-detail" not in response.text


def test_non_http_tool_cannot_be_test_invoked(tmp_path):
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'http-tool-runtime-non-http.db'}",
    )
    tool = client.post(
        workspace_url(workspace_id, "/asset-library"),
        json={
            "assetType": "tool",
            "name": "手工工具",
            "description": "Manual tool",
            "parameterSchema": {"type": "object"},
        },
        headers=csrf_headers(client),
    ).json()

    response = client.post(
        workspace_url(workspace_id, f"/asset-library/{tool['id']}/test-invocations"),
        json={"parameters": {}},
        headers=csrf_headers(client),
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "仅 HTTP / MCP Tool 支持测试调用"


def test_mcp_tool_test_invocation_writes_success_log(tmp_path):
    gateway = FakeHttpToolGateway([
        ToolRuntimeGatewayResult(output_summary="doc title=AI Notes", raw_output={"title": "AI Notes"}),
    ])
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'mcp-tool-runtime.db'}",
        mcp_gateway=gateway,
    )
    tool = create_mcp_tool(client, workspace_id)

    response = client.post(
        workspace_url(workspace_id, f"/asset-library/{tool['id']}/test-invocations"),
        json={"parameters": {"docToken": "doc-1"}},
        headers=csrf_headers(client),
    )
    logs = client.get(
        workspace_url(workspace_id, f"/asset-library/invocations?assetId={tool['id']}"),
    ).json()

    assert response.status_code == 201
    assert response.json()["status"] == "succeeded"
    assert response.json()["outputSummary"] == "doc title=AI Notes"
    assert logs[0]["id"] == response.json()["id"]
    assert gateway.calls == [{
        "config": {"server": "lark-doc", "tool": "get_doc"},
        "parameters": {"docToken": "doc-1"},
    }]


def test_agent_test_run_writes_http_tool_invocation_with_run_context(tmp_path):
    tool_gateway = FakeHttpToolGateway([
        ToolRuntimeGatewayResult(output_summary="price=199", raw_output={"price": 199}),
    ])
    model_gateway = FakeModelGateway([
        FakeModelResult("The answer uses the price tool evidence and is long enough."),
    ])
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'agent-http-tool-runtime.db'}",
        model_gateway=model_gateway,
        tool_gateway=tool_gateway,
    )
    tool = create_http_tool(client, workspace_id)
    agent, version = create_agent_bound_to_tool(
        client,
        workspace_id,
        tool_name=tool["name"],
    )

    response = client.post(
        workspace_url(workspace_id, f"/agents/{agent['id']}/test-runs"),
        json={"input": "Lookup SKU A001", "version": version["version"]},
        headers=csrf_headers(client),
    )
    logs = client.get(
        workspace_url(workspace_id, f"/asset-library/invocations?assetId={tool['id']}"),
    ).json()

    assert response.status_code == 201
    assert logs[0]["status"] == "succeeded"
    assert logs[0]["agentId"] == agent["id"]
    assert logs[0]["agentVersion"] == version["version"]
    assert logs[0]["runId"] == response.json()["id"]
    assert logs[0]["nodeRunId"] == response.json()["nodes"][0]["id"]
    assert logs[0]["inputSummary"] == '{"input": "Lookup SKU A001"}'
    assert logs[0]["outputSummary"] == "price=199"
    assert tool_gateway.calls == [{
        "config": {"method": "POST", "url": "https://internal.example.test/price"},
        "parameters": {"input": "Lookup SKU A001"},
    }]


def test_agent_test_run_invokes_http_tool_by_published_asset_ref_after_rename(tmp_path):
    tool_gateway = FakeHttpToolGateway([
        ToolRuntimeGatewayResult(output_summary="price=199", raw_output={"price": 199}),
    ])
    model_gateway = FakeModelGateway([
        FakeModelResult("The answer uses the renamed tool evidence and is long enough."),
    ])
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'agent-http-tool-runtime-stable-ref.db'}",
        model_gateway=model_gateway,
        tool_gateway=tool_gateway,
    )
    tool = create_http_tool(client, workspace_id, name="价格查询")
    agent, version = create_agent_bound_to_tool(
        client,
        workspace_id,
        tool_name=tool["name"],
    )
    rename = client.patch(
        workspace_url(workspace_id, f"/asset-library/{tool['id']}"),
        json={"name": "价格查询 V2"},
        headers=csrf_headers(client),
    )

    response = client.post(
        workspace_url(workspace_id, f"/agents/{agent['id']}/test-runs"),
        json={"input": "Lookup SKU A001", "version": version["version"]},
        headers=csrf_headers(client),
    )
    logs = client.get(
        workspace_url(workspace_id, f"/asset-library/invocations?assetId={tool['id']}"),
    ).json()

    assert rename.status_code == 200
    assert response.status_code == 201
    assert tool_gateway.calls == [{
        "config": {"method": "POST", "url": "https://internal.example.test/price"},
        "parameters": {"input": "Lookup SKU A001"},
    }]
    assert "工具调用结果" in model_gateway.calls[0]["user_input"]
    assert "price=199" in model_gateway.calls[0]["user_input"]
    assert logs[0]["assetId"] == tool["id"]
    assert logs[0]["assetName"] == "价格查询 V2"
    assert logs[0]["agentVersion"] == version["version"]
    assert "apiKey" not in response.text


def test_agent_test_run_falls_back_to_legacy_tool_names_without_asset_refs(tmp_path):
    tool_gateway = FakeHttpToolGateway([
        ToolRuntimeGatewayResult(output_summary="price=199", raw_output={"price": 199}),
    ])
    model_gateway = FakeModelGateway([
        FakeModelResult("The answer uses the legacy tool name and is long enough."),
    ])
    client, workspace_id = create_authenticated_client(
        f"sqlite:///{tmp_path / 'agent-http-tool-runtime-legacy-name.db'}",
        model_gateway=model_gateway,
        tool_gateway=tool_gateway,
    )
    tool = create_http_tool(client, workspace_id, name="价格查询")
    agent, version = create_agent_bound_to_tool(
        client,
        workspace_id,
        tool_name=tool["name"],
    )
    with client.app.state.session_factory() as session:
        record = session.scalar(select(AgentVersionRecord).where(AgentVersionRecord.id == version["id"]))
        assert record is not None
        snapshot = dict(record.snapshot)
        snapshot.pop("toolAssetRefs", None)
        snapshot.pop("skillAssetRefs", None)
        record.snapshot = snapshot
        session.commit()

    response = client.post(
        workspace_url(workspace_id, f"/agents/{agent['id']}/test-runs"),
        json={"input": "Lookup SKU A001", "version": version["version"]},
        headers=csrf_headers(client),
    )

    assert response.status_code == 201
    assert tool_gateway.calls == [{
        "config": {"method": "POST", "url": "https://internal.example.test/price"},
        "parameters": {"input": "Lookup SKU A001"},
    }]


def test_httpx_tool_gateway_rejects_hosts_outside_allowlist():
    gateway = HttpxToolGateway(
        Settings(tool_http_allowed_hosts=("allowed.example.test",)),
    )

    with pytest.raises(ToolRuntimeGatewayError):
        gateway.execute(
            config={"method": "POST", "url": "https://blocked.example.test/price"},
            parameters={"sku": "A001"},
        )


def test_httpx_tool_gateway_posts_parameters_to_allowed_host():
    requests: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append({
            "method": request.method,
            "url": str(request.url),
            "body": request.content.decode("utf-8"),
        })
        return httpx.Response(200, json={"price": 199})

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        gateway = HttpxToolGateway(
            Settings(tool_http_allowed_hosts=("internal.example.test",)),
            client=client,
        )

        result = gateway.execute(
            config={"method": "POST", "url": "https://internal.example.test/price"},
            parameters={"sku": "A001"},
        )

    assert requests == [{
        "method": "POST",
        "url": "https://internal.example.test/price",
        "body": '{"sku":"A001"}',
    }]
    assert result.output_summary == '{"price":199}'
    assert result.raw_output == {"price": 199}
