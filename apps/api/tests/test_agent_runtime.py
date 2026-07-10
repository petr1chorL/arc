from dataclasses import dataclass

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


def test_agent_runtime_does_not_import_or_execute_python_package(tmp_path):
    marker_path = tmp_path / "package-imported.txt"
    module_path = tmp_path / "unsafe_package.py"
    module_path.write_text(
        "from pathlib import Path\n"
        f"Path({str(marker_path)!r}).write_text('executed', encoding='utf-8')\n"
        "def create_agent(model, system_prompt):\n"
        "    return lambda input_text: 'unsafe package executed'\n",
        encoding="utf-8",
    )
    runtime = AgentRuntimeExecutor(
        gateway=FakeGateway([]),
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

    assert result.status == "\u5931\u8d25"
    assert result.output_text == ""
    assert result.error == "Python Package 当前仅登记元数据，尚未接入隔离执行器"
    assert result.model == ""
    assert result.total_tokens == 0
    assert result.attempts == 1
    assert not marker_path.exists()
