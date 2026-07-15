from dataclasses import dataclass

from app.agent_api_gateway import AgentApiGatewayError
from app.agent_runtime import AgentRuntimeExecutor, AgentRuntimeRequest


@dataclass
class FakeModelResult:
    content: str
    model: str = "runtime-model"
    prompt_tokens: int = 10
    completion_tokens: int = 6


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
    model: str = "remote-model-v1"
    prompt_tokens: int = 13
    completion_tokens: int = 7
    cost_usd: float = 0.0042
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


def runtime_request() -> AgentRuntimeRequest:
    return AgentRuntimeRequest(
        workspace_id="workspace-1",
        run_id="run-1",
        node_id="agent-node",
        node_name="Insight Agent",
        agent_id="agent-1",
        agent_version="v1",
        input_text="Summarize the request.",
        system_prompt="Respond clearly.",
        model="configured-model",
        tools=["Search"],
        skills=["Reasoning"],
    )


def remote_runtime_request() -> AgentRuntimeRequest:
    request = runtime_request()
    request.invocation_id = "stable-invocation-id"
    request.node_run_id = "node-run-1"
    request.runtime_manifest = {
        "runtime": "remote_http",
        "sourceType": "remote_api",
        "protocolVersion": "arc-agent-v1",
        "endpointUrl": "https://agent.example.com/v1/invoke",
        "secretRef": "REMOTE_AGENT_API_TOKEN",
        "timeoutSeconds": 7,
    }
    return request


def test_agent_runtime_returns_structured_success_result():
    gateway = FakeGateway([
        FakeModelResult("This runtime output is long enough to pass the quality gate."),
    ])
    runtime = AgentRuntimeExecutor(
        gateway=gateway,
        cost_calculator=lambda prompt, completion: round((prompt + completion) / 1000, 4),
    )

    result = runtime.execute(runtime_request())

    assert result.status == "\u5df2\u5b8c\u6210"
    assert result.output_text.startswith("This runtime output")
    assert result.error == ""
    assert result.model == "runtime-model"
    assert result.prompt_tokens == 10
    assert result.completion_tokens == 6
    assert result.total_tokens == 16
    assert result.cost_usd == 0.016
    assert result.score == 100
    assert result.attempts == 1
    assert result.duration_ms >= 0
    assert result.tool_calls == []
    assert gateway.calls == [{
        "system_prompt": "Respond clearly.",
        "user_input": "Summarize the request.",
        "model": "configured-model",
        "model_provider_id": None,
        "model_provider": "openai-compatible",
        "model_base_url": "",
        "model_secret_ref": "",
        "temperature": 0.2,
        "max_output_tokens": 2000,
    }]


def test_agent_runtime_retries_blank_output_before_returning_success():
    gateway = FakeGateway([
        FakeModelResult("   \n"),
        FakeModelResult("This retry produced a valid non-empty Agent output."),
    ])
    runtime = AgentRuntimeExecutor(
        gateway=gateway,
        cost_calculator=lambda prompt, completion: 0,
    )

    result = runtime.execute(runtime_request(), max_attempts=2)

    assert result.status == "已完成"
    assert result.output_text.startswith("This retry produced")
    assert result.attempts == 2
    assert len(gateway.calls) == 2


def test_agent_runtime_fails_when_blank_output_exhausts_retries():
    gateway = FakeGateway([
        FakeModelResult(""),
        FakeModelResult(" \t\n"),
    ])
    runtime = AgentRuntimeExecutor(
        gateway=gateway,
        cost_calculator=lambda prompt, completion: 0,
    )

    result = runtime.execute(runtime_request(), max_attempts=2)

    assert result.status == "失败"
    assert result.output_text == ""
    assert result.error == "模型未返回有效内容，Agent 执行失败，请稍后重试"
    assert result.score == 0
    assert result.attempts == 2
    assert len(gateway.calls) == 2


def test_agent_runtime_returns_sanitized_failure_result():
    gateway = FakeGateway([
        RuntimeError("provider-secret-detail"),
        RuntimeError("provider-secret-detail"),
    ])
    runtime = AgentRuntimeExecutor(
        gateway=gateway,
        cost_calculator=lambda prompt, completion: 0,
    )

    result = runtime.execute(runtime_request(), max_attempts=2)

    assert result.status == "\u5931\u8d25"
    assert result.output_text == ""
    assert result.error == "\u0041gent \u6267\u884c\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5"
    assert result.model == ""
    assert result.prompt_tokens == 0
    assert result.completion_tokens == 0
    assert result.total_tokens == 0
    assert result.cost_usd == 0
    assert result.score == 0
    assert result.attempts == 2
    assert result.tool_calls == []
    assert "provider-secret-detail" not in result.error


def test_agent_runtime_reports_missing_model_credentials_without_secret_details():
    gateway = FakeGateway([
        RuntimeError("Missing credentials. Please pass an api_key."),
    ])
    runtime = AgentRuntimeExecutor(
        gateway=gateway,
        cost_calculator=lambda prompt, completion: 0,
    )

    result = runtime.execute(runtime_request(), max_attempts=1)

    assert result.status == "\u5931\u8d25"
    assert result.error == (
        "\u004cangChain \u8fd0\u884c\u65f6\u7f3a\u5c11\u6a21\u578b\u51ed\u8bc1\uff0c"
        "\u8bf7\u5728\u6a21\u578b\u8d44\u4ea7\u6216\u73af\u5883\u53d8\u91cf\u4e2d\u914d\u7f6e\u540e\u91cd\u8bd5"
    )
    assert "api_key" not in result.error


def test_agent_runtime_remote_http_uses_agent_api_gateway_without_model_call():
    model_gateway = FakeGateway([])
    agent_api_gateway = FakeAgentApiGateway(FakeAgentApiResult(
        output_text="Remote Agent produced a valid non-empty result.",
        tool_calls=[],
    ))
    runtime = AgentRuntimeExecutor(
        gateway=model_gateway,
        agent_api_gateway=agent_api_gateway,
        cost_calculator=lambda prompt, completion: round((prompt + completion) / 1000, 4),
    )
    request = runtime_request()
    request.invocation_id = "invocation-1"
    request.node_run_id = "node-run-1"
    request.runtime_manifest = {
        "runtime": "remote_http",
        "sourceType": "remote_api",
        "protocolVersion": "arc-agent-v1",
        "endpointUrl": "https://agent.example.com/v1/invoke",
        "secretRef": "REMOTE_AGENT_API_TOKEN",
        "timeoutSeconds": 7,
    }

    result = runtime.execute(request)

    assert result.status == "已完成"
    assert result.output_text == "Remote Agent produced a valid non-empty result."
    assert result.error == ""
    assert result.model == "remote-model-v1"
    assert result.prompt_tokens == 13
    assert result.completion_tokens == 7
    assert result.total_tokens == 20
    assert result.cost_usd == 0.0042
    assert result.score == 100
    assert result.attempts == 1
    assert result.tool_calls == []
    assert model_gateway.calls == []
    assert agent_api_gateway.calls == [{
        "endpoint_url": "https://agent.example.com/v1/invoke",
        "secret_ref": "REMOTE_AGENT_API_TOKEN",
        "timeout_seconds": 7,
        "invocation_id": "invocation-1",
        "workspace_id": "workspace-1",
        "run_id": "run-1",
        "node_run_id": "node-run-1",
        "node_id": "agent-node",
        "node_name": "Insight Agent",
        "agent_id": "agent-1",
        "agent_version": "v1",
        "input_text": "Summarize the request.",
        "system_prompt": "Respond clearly.",
        "tools": ["Search"],
        "skills": ["Reasoning"],
        "max_total_tokens": 2_147_483_647,
    }]


def test_agent_runtime_remote_http_passes_remaining_token_budget():
    model_gateway = FakeGateway([])
    agent_api_gateway = FakeAgentApiGateway(FakeAgentApiResult(
        output_text="Remote Agent stayed within the remaining token budget.",
        prompt_tokens=11,
        completion_tokens=8,
    ))
    runtime = AgentRuntimeExecutor(
        gateway=model_gateway,
        agent_api_gateway=agent_api_gateway,
        cost_calculator=lambda prompt, completion: 0,
    )
    request = remote_runtime_request()
    request.max_total_tokens = 19

    result = runtime.execute(request)

    assert result.status == "已完成"
    assert result.total_tokens == 19
    assert agent_api_gateway.calls[0]["max_total_tokens"] == 19


def test_agent_runtime_remote_http_rejects_usage_over_remaining_budget():
    model_gateway = FakeGateway([])
    agent_api_gateway = FakeAgentApiGateway(FakeAgentApiResult(
        output_text="This result reports more tokens than the run can persist.",
        prompt_tokens=13,
        completion_tokens=7,
    ))
    runtime = AgentRuntimeExecutor(
        gateway=model_gateway,
        agent_api_gateway=agent_api_gateway,
        cost_calculator=lambda prompt, completion: 0,
    )
    request = remote_runtime_request()
    request.max_total_tokens = 19

    result = runtime.execute(request, max_attempts=2)

    assert result.status == "失败"
    assert result.error == "远程 Agent API 执行失败，请稍后重试"
    assert result.prompt_tokens == 0
    assert result.completion_tokens == 0
    assert result.total_tokens == 0
    assert result.cost_usd == 0
    assert result.attempts == 1
    assert len(agent_api_gateway.calls) == 1


def test_agent_runtime_remote_http_rejects_invalid_custom_gateway_usage():
    model_gateway = FakeGateway([])
    agent_api_gateway = FakeAgentApiGateway(FakeAgentApiResult(
        output_text="This result contains invalid token usage.",
        prompt_tokens=True,
        completion_tokens=-1,
    ))
    runtime = AgentRuntimeExecutor(
        gateway=model_gateway,
        agent_api_gateway=agent_api_gateway,
        cost_calculator=lambda prompt, completion: 0,
    )

    result = runtime.execute(remote_runtime_request(), max_attempts=2)

    assert result.status == "失败"
    assert result.error == "远程 Agent API 执行失败，请稍后重试"
    assert result.prompt_tokens == 0
    assert result.completion_tokens == 0
    assert result.total_tokens == 0
    assert result.cost_usd == 0
    assert result.attempts == 1
    assert len(agent_api_gateway.calls) == 1


def test_agent_runtime_remote_http_retries_retryable_failure_with_same_invocation_id():
    model_gateway = FakeGateway([])
    agent_api_gateway = SequencedAgentApiGateway([
        AgentApiGatewayError("upstream detail", retryable=True),
        FakeAgentApiResult(output_text="Remote retry produced a valid result."),
    ])
    runtime = AgentRuntimeExecutor(
        gateway=model_gateway,
        agent_api_gateway=agent_api_gateway,
        cost_calculator=lambda prompt, completion: 0,
    )

    result = runtime.execute(remote_runtime_request(), max_attempts=2)

    assert result.status == "已完成"
    assert result.attempts == 2
    assert [call["invocation_id"] for call in agent_api_gateway.calls] == [
        "stable-invocation-id",
        "stable-invocation-id",
    ]
    assert model_gateway.calls == []


def test_agent_runtime_remote_http_does_not_retry_nonretryable_failure():
    model_gateway = FakeGateway([])
    agent_api_gateway = SequencedAgentApiGateway([
        AgentApiGatewayError("forbidden token detail", retryable=False),
        FakeAgentApiResult(output_text="This result must never be used."),
    ])
    runtime = AgentRuntimeExecutor(
        gateway=model_gateway,
        agent_api_gateway=agent_api_gateway,
        cost_calculator=lambda prompt, completion: 0,
    )

    result = runtime.execute(remote_runtime_request(), max_attempts=2)

    assert result.status == "失败"
    assert result.attempts == 1
    assert result.error == "远程 Agent API 执行失败，请稍后重试"
    assert "forbidden token detail" not in result.error
    assert len(agent_api_gateway.calls) == 1
    assert model_gateway.calls == []


def test_agent_runtime_remote_http_defensively_caps_retry_attempts():
    model_gateway = FakeGateway([])
    agent_api_gateway = SequencedAgentApiGateway([
        AgentApiGatewayError("temporary outage", retryable=True)
        for _ in range(10)
    ])
    runtime = AgentRuntimeExecutor(
        gateway=model_gateway,
        agent_api_gateway=agent_api_gateway,
        cost_calculator=lambda prompt, completion: 0,
    )

    result = runtime.execute(remote_runtime_request(), max_attempts=999)

    assert result.status == "失败"
    assert result.attempts == 3
    assert len(agent_api_gateway.calls) == 3


def test_agent_runtime_legacy_python_package_stays_disabled(tmp_path):
    marker_path = tmp_path / "package-imported.txt"
    module_path = tmp_path / "unsafe_package.py"
    module_path.write_text(
        "from pathlib import Path\n"
        f"Path({str(marker_path)!r}).write_text('executed', encoding='utf-8')\n"
        "def create_agent(model, system_prompt):\n"
        "    return lambda input_text: 'unsafe package executed'\n",
        encoding="utf-8",
    )
    model_gateway = FakeGateway([])
    runtime = AgentRuntimeExecutor(
        gateway=model_gateway,
        cost_calculator=lambda prompt, completion: 0,
    )
    request = runtime_request()
    request.runtime_manifest = {
        "runtime": "langchain",
        "sourceType": "python_package",
        "entrypoint": "unsafe_package:create_agent",
        "packageSource": str(tmp_path),
    }

    result = runtime.execute(request)

    assert result.status == "失败"
    assert result.output_text == ""
    assert result.error == "该 Agent 使用已停止支持的运行方式，请改为远程 Agent API"
    assert result.model == ""
    assert result.total_tokens == 0
    assert result.attempts == 1
    assert not marker_path.exists()
    assert model_gateway.calls == []
