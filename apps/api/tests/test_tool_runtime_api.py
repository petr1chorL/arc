from dataclasses import dataclass

from api_test_support import create_authenticated_client, csrf_headers, workspace_url
from app.tool_runtime import ToolRuntimeGatewayError, ToolRuntimeGatewayResult


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
    assert response.json()["detail"] == "仅 HTTP Tool 支持测试调用"
