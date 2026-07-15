import asyncio
import json
import time
from threading import Event

import httpx
import pytest

from app.agent_api_gateway import AgentApiGatewayError, HttpxAgentApiGateway
from app.config import Settings


def execute_remote_agent(
    gateway: HttpxAgentApiGateway,
    *,
    endpoint_url: str = "https://agent.example.com/v1/invoke",
    secret_ref: str = "REMOTE_AGENT_API_TOKEN",
    workspace_id: str = "workspace-1",
    timeout_seconds: float = 7,
    max_total_tokens: int = 2_147_483_647,
):
    return gateway.execute(
        endpoint_url=endpoint_url,
        secret_ref=secret_ref,
        timeout_seconds=timeout_seconds,
        invocation_id="invocation-1",
        workspace_id=workspace_id,
        run_id="run-1",
        node_run_id="node-run-1",
        node_id="agent-node",
        node_name="Insight Agent",
        agent_id="agent-1",
        agent_version="v1.0.0",
        input_text="Summarize the customer request.",
        system_prompt="Respond clearly.",
        tools=["Search"],
        skills=["Reasoning"],
        max_total_tokens=max_total_tokens,
    )


def test_agent_api_gateway_rejects_sync_only_transport_at_construction():
    class SyncOnlyTransport(httpx.BaseTransport):
        def handle_request(self, request: httpx.Request) -> httpx.Response:
            raise AssertionError("sync transport must never be used")

    with pytest.raises(TypeError, match="AsyncBaseTransport"):
        HttpxAgentApiGateway(
            Settings(),
            transport=SyncOnlyTransport(),
        )


def test_agent_api_gateway_sends_authorization_and_idempotency_headers(monkeypatch):
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured.update({
            "url": str(request.url),
            "headers": dict(request.headers),
            "json": json.loads(request.content),
        })
        return httpx.Response(
            200,
            headers={"content-type": "application/json"},
            json={
                "protocolVersion": "arc-agent-v1",
                "invocationId": "invocation-1",
                "output": "Remote Agent produced a valid structured result.",
                "usage": {
                    "model": "remote-model-v1",
                    "promptTokens": 12,
                    "completionTokens": 8,
                    "costUsd": 0.0042,
                },
                "toolCalls": [],
            },
        )

    monkeypatch.setenv("REMOTE_AGENT_API_TOKEN", "remote-secret-value")
    settings = Settings(
        agent_api_allowed_bindings=("workspace-1@agent.example.com=REMOTE_AGENT_API_TOKEN",),
        agent_api_max_response_bytes=1024,
    )
    transport = httpx.MockTransport(handler)

    result = execute_remote_agent(
        HttpxAgentApiGateway(settings, transport=transport),
        max_total_tokens=20,
    )

    assert captured["url"] == "https://agent.example.com/v1/invoke"
    assert captured["headers"]["authorization"] == "Bearer remote-secret-value"
    assert captured["headers"]["idempotency-key"] == "invocation-1"
    assert captured["json"] == {
        "protocolVersion": "arc-agent-v1",
        "invocationId": "invocation-1",
        "agent": {"id": "agent-1", "version": "v1.0.0"},
        "run": {"id": "run-1", "nodeRunId": "node-run-1", "nodeId": "agent-node"},
        "input": "Summarize the customer request.",
        "context": {
            "workspaceId": "workspace-1",
            "nodeName": "Insight Agent",
            "systemPrompt": "Respond clearly.",
            "tools": ["Search"],
            "skills": ["Reasoning"],
        },
    }
    assert result.output_text == "Remote Agent produced a valid structured result."
    assert result.model == "remote-model-v1"
    assert result.prompt_tokens == 12
    assert result.completion_tokens == 8
    assert result.cost_usd == 0.0042
    assert result.tool_calls == []


def test_agent_api_gateway_rejects_unapproved_host_without_http_call(monkeypatch):
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        raise AssertionError("HTTP must not be called for an unapproved Agent host")

    monkeypatch.setenv("REMOTE_AGENT_API_TOKEN", "remote-secret-value")
    settings = Settings(
        agent_api_allowed_bindings=("workspace-1@approved.example.com=REMOTE_AGENT_API_TOKEN",),
        agent_api_max_response_bytes=1024,
    )
    gateway = HttpxAgentApiGateway(
        settings,
        transport=httpx.MockTransport(handler),
    )

    with pytest.raises(AgentApiGatewayError, match="远程 Agent 地址未获准"):
        execute_remote_agent(gateway)

    assert calls == 0


def test_agent_api_gateway_rejects_missing_secret_without_http_call(monkeypatch):
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        raise AssertionError("HTTP must not be called without the bound Agent secret")

    monkeypatch.delenv("REMOTE_AGENT_API_TOKEN", raising=False)
    settings = Settings(
        agent_api_allowed_bindings=("workspace-1@agent.example.com=REMOTE_AGENT_API_TOKEN",),
        agent_api_max_response_bytes=1024,
    )
    gateway = HttpxAgentApiGateway(
        settings,
        transport=httpx.MockTransport(handler),
    )

    with pytest.raises(AgentApiGatewayError, match="远程 Agent 凭证未配置"):
        execute_remote_agent(gateway)

    assert calls == 0


def test_agent_api_gateway_rejects_unbound_environment_secret_without_http_call(monkeypatch):
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        raise AssertionError("HTTP must not be called with an unrelated process secret")

    monkeypatch.setenv("DATABASE_URL", "must-not-leave-the-process")
    settings = Settings(
        agent_api_allowed_bindings=("workspace-1@agent.example.com=REMOTE_AGENT_API_TOKEN",),
        agent_api_max_response_bytes=1024,
    )
    gateway = HttpxAgentApiGateway(
        settings,
        transport=httpx.MockTransport(handler),
    )

    with pytest.raises(AgentApiGatewayError, match="远程 Agent 地址与凭证未获准"):
        execute_remote_agent(gateway, secret_ref="DATABASE_URL")

    assert calls == 0


def test_agent_api_gateway_rejects_binding_from_another_workspace_without_http_call(monkeypatch):
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        raise AssertionError("HTTP must not be called with another workspace binding")

    monkeypatch.setenv("REMOTE_AGENT_API_TOKEN", "remote-secret-value")
    settings = Settings(
        agent_api_allowed_bindings=("workspace-2@agent.example.com=REMOTE_AGENT_API_TOKEN",),
        agent_api_max_response_bytes=1024,
    )
    gateway = HttpxAgentApiGateway(
        settings,
        transport=httpx.MockTransport(handler),
    )

    with pytest.raises(AgentApiGatewayError, match="远程 Agent 地址未获准"):
        execute_remote_agent(gateway, workspace_id="workspace-1")

    assert calls == 0


def test_agent_api_gateway_rejects_mismatched_response_invocation_id(monkeypatch):
    monkeypatch.setenv("REMOTE_AGENT_API_TOKEN", "remote-secret-value")
    settings = Settings(
        agent_api_allowed_bindings=("workspace-1@agent.example.com=REMOTE_AGENT_API_TOKEN",),
        agent_api_max_response_bytes=1024,
    )
    gateway = HttpxAgentApiGateway(
        settings,
        transport=httpx.MockTransport(lambda request: httpx.Response(
            200,
            headers={"content-type": "application/json"},
            json={
                "protocolVersion": "arc-agent-v1",
                "invocationId": "different-invocation",
                "output": "This response belongs to another invocation.",
                "usage": {"model": "remote-model-v1", "promptTokens": 1, "completionTokens": 1, "costUsd": 0},
                "toolCalls": [],
            },
        )),
    )

    with pytest.raises(AgentApiGatewayError, match="远程 Agent 响应标识不匹配"):
        execute_remote_agent(gateway)


def test_agent_api_gateway_rejects_oversized_response(monkeypatch):
    monkeypatch.setenv("REMOTE_AGENT_API_TOKEN", "remote-secret-value")
    settings = Settings(
        agent_api_allowed_bindings=("workspace-1@agent.example.com=REMOTE_AGENT_API_TOKEN",),
        agent_api_max_response_bytes=128,
    )
    gateway = HttpxAgentApiGateway(
        settings,
        transport=httpx.MockTransport(lambda request: httpx.Response(
            200,
            headers={"content-type": "application/json"},
            json={
                "protocolVersion": "arc-agent-v1",
                "invocationId": "invocation-1",
                "output": "x" * 512,
                "usage": {"model": "remote-model-v1", "promptTokens": 1, "completionTokens": 1, "costUsd": 0},
                "toolCalls": [],
            },
        )),
    )

    with pytest.raises(AgentApiGatewayError, match="远程 Agent 响应过大"):
        execute_remote_agent(gateway)


@pytest.mark.parametrize("status_code", [429, 500, 502, 503, 504])
def test_agent_api_gateway_marks_transient_http_status_as_retryable(monkeypatch, status_code):
    monkeypatch.setenv("REMOTE_AGENT_API_TOKEN", "remote-secret-value")
    settings = Settings(
        agent_api_allowed_bindings=("workspace-1@agent.example.com=REMOTE_AGENT_API_TOKEN",),
    )
    gateway = HttpxAgentApiGateway(
        settings,
        transport=httpx.MockTransport(
            lambda request: httpx.Response(status_code),
        ),
    )

    with pytest.raises(AgentApiGatewayError) as caught:
        execute_remote_agent(gateway)

    assert caught.value.retryable is True


@pytest.mark.parametrize("status_code", [400, 401, 403, 404])
def test_agent_api_gateway_marks_client_http_status_as_nonretryable(monkeypatch, status_code):
    monkeypatch.setenv("REMOTE_AGENT_API_TOKEN", "remote-secret-value")
    settings = Settings(
        agent_api_allowed_bindings=("workspace-1@agent.example.com=REMOTE_AGENT_API_TOKEN",),
    )
    gateway = HttpxAgentApiGateway(
        settings,
        transport=httpx.MockTransport(
            lambda request: httpx.Response(status_code),
        ),
    )

    with pytest.raises(AgentApiGatewayError) as caught:
        execute_remote_agent(gateway)

    assert caught.value.retryable is False


def test_agent_api_gateway_cancels_request_before_response_headers_at_deadline(monkeypatch):
    cancelled = Event()

    async def handler(request: httpx.Request) -> httpx.Response:
        try:
            await asyncio.sleep(2)
        except asyncio.CancelledError:
            cancelled.set()
            raise
        return httpx.Response(
            200,
            headers={"content-type": "application/json"},
            json={
                "protocolVersion": "arc-agent-v1",
                "invocationId": "invocation-1",
                "output": "This response must not outlive the deadline.",
                "usage": {},
                "toolCalls": [],
            },
        )

    monkeypatch.setenv("REMOTE_AGENT_API_TOKEN", "remote-secret-value")
    settings = Settings(
        agent_api_allowed_bindings=(
            "workspace-1@agent.example.com=REMOTE_AGENT_API_TOKEN",
        ),
    )
    gateway = HttpxAgentApiGateway(
        settings,
        transport=httpx.MockTransport(handler),
    )

    started = time.perf_counter()
    with pytest.raises(AgentApiGatewayError) as caught:
        execute_remote_agent(gateway, timeout_seconds=0.05)
    elapsed = time.perf_counter() - started

    assert caught.value.retryable is True
    assert elapsed < 0.5
    assert cancelled.wait(0.5)


def test_agent_api_gateway_cancels_response_body_at_total_deadline(monkeypatch):
    cancelled = Event()

    class SlowResponseBody(httpx.AsyncByteStream):
        async def __aiter__(self):
            yield b'{"protocolVersion":"arc-agent-v1",'
            try:
                await asyncio.sleep(2)
            except asyncio.CancelledError:
                cancelled.set()
                raise

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"content-type": "application/json"},
            stream=SlowResponseBody(),
        )

    monkeypatch.setenv("REMOTE_AGENT_API_TOKEN", "remote-secret-value")
    settings = Settings(
        agent_api_allowed_bindings=(
            "workspace-1@agent.example.com=REMOTE_AGENT_API_TOKEN",
        ),
    )
    gateway = HttpxAgentApiGateway(
        settings,
        transport=httpx.MockTransport(handler),
    )

    started = time.perf_counter()
    with pytest.raises(AgentApiGatewayError) as caught:
        execute_remote_agent(gateway, timeout_seconds=0.05)
    elapsed = time.perf_counter() - started

    assert caught.value.retryable is True
    assert elapsed < 0.5
    assert cancelled.wait(0.5)


@pytest.mark.parametrize(("content_type", "usage"), [
    ("application/jsonp", {"model": "remote-model", "promptTokens": 1, "completionTokens": 1, "costUsd": 0}),
    ("application/json", {"model": "x" * 121, "promptTokens": 1, "completionTokens": 1, "costUsd": 0}),
    ("application/json", {"model": "remote-model", "promptTokens": 2_000_000_000, "completionTokens": 2_000_000_000, "costUsd": 0}),
])
def test_agent_api_gateway_rejects_response_outside_persistence_contract(monkeypatch, content_type, usage):
    monkeypatch.setenv("REMOTE_AGENT_API_TOKEN", "remote-secret-value")
    settings = Settings(
        agent_api_allowed_bindings=("workspace-1@agent.example.com=REMOTE_AGENT_API_TOKEN",),
    )
    gateway = HttpxAgentApiGateway(
        settings,
        transport=httpx.MockTransport(lambda request: httpx.Response(
            200,
            headers={"content-type": content_type},
            json={
                "protocolVersion": "arc-agent-v1",
                "invocationId": "invocation-1",
                "output": "Remote Agent produced a valid structured result.",
                "usage": usage,
                "toolCalls": [],
            },
        )),
    )

    with pytest.raises(AgentApiGatewayError, match="远程 Agent 响应"):
        execute_remote_agent(gateway)


def test_agent_api_gateway_rejects_usage_above_remaining_run_budget(monkeypatch):
    monkeypatch.setenv("REMOTE_AGENT_API_TOKEN", "remote-secret-value")
    settings = Settings(
        agent_api_allowed_bindings=("workspace-1@agent.example.com=REMOTE_AGENT_API_TOKEN",),
    )
    gateway = HttpxAgentApiGateway(
        settings,
        transport=httpx.MockTransport(lambda request: httpx.Response(
            200,
            headers={"content-type": "application/json"},
            json={
                "protocolVersion": "arc-agent-v1",
                "invocationId": "invocation-1",
                "output": "Remote Agent produced a valid structured result.",
                "usage": {
                    "model": "remote-model",
                    "promptTokens": 12,
                    "completionTokens": 8,
                    "costUsd": 0,
                },
                "toolCalls": [],
            },
        )),
    )

    with pytest.raises(AgentApiGatewayError, match="远程 Agent 响应"):
        execute_remote_agent(gateway, max_total_tokens=19)
