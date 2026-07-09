from dataclasses import dataclass
import sys
from types import ModuleType

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


def test_agent_runtime_invokes_langchain_python_package_entrypoint(monkeypatch):
    module = ModuleType("fake_weather_agent")
    calls = []

    class FakeLangChainAgent:
        def invoke(self, payload):
            calls.append(payload)
            return {
                "messages": [
                    {"role": "user", "content": "Changsha weather"},
                    {"role": "assistant", "content": "It is always sunny in Changsha."},
                ],
            }

    def create_agent(model: str, system_prompt: str):
        calls.append({"model": model, "system_prompt": system_prompt})
        return FakeLangChainAgent()

    module.create_agent = create_agent
    monkeypatch.setitem(sys.modules, "fake_weather_agent", module)
    runtime = AgentRuntimeExecutor(
        gateway=FakeGateway([]),
        cost_calculator=lambda prompt, completion: 0,
    )
    request = runtime_request()
    request.runtime_manifest = {
        "runtime": "langchain",
        "sourceType": "python_package",
        "entrypoint": "fake_weather_agent:create_agent",
    }

    result = runtime.execute(request)

    assert result.status == "\u5df2\u5b8c\u6210"
    assert result.output_text == "It is always sunny in Changsha."
    assert result.model == "configured-model"
    assert result.total_tokens == 0
    assert calls == [
        {"model": "configured-model", "system_prompt": "Respond clearly."},
        {"messages": [{"role": "user", "content": "Summarize the request."}]},
    ]


def test_langchain_package_runtime_uses_provider_model_object(monkeypatch):
    weather_module = ModuleType("fake_weather_agent_with_provider")
    langchain_openai_module = ModuleType("langchain_openai")
    calls = []

    class FakeChatOpenAI:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

    class FakeLangChainAgent:
        def invoke(self, payload):
            calls.append(payload)
            return {"output": "Weather provider call completed."}

    def create_agent(model: object, system_prompt: str):
        calls.append({"model": model, "system_prompt": system_prompt})
        return FakeLangChainAgent()

    langchain_openai_module.ChatOpenAI = FakeChatOpenAI
    weather_module.create_agent = create_agent
    monkeypatch.setitem(sys.modules, "langchain_openai", langchain_openai_module)
    monkeypatch.setitem(sys.modules, "fake_weather_agent_with_provider", weather_module)
    runtime = AgentRuntimeExecutor(
        gateway=FakeGateway([]),
        cost_calculator=lambda prompt, completion: 0,
    )
    request = runtime_request()
    request.model = "deepseek-v4-pro"
    request.model_base_url = "https://api.deepseek.com"
    request.model_secret_ref = "sk-test-inline-key"
    request.temperature = 0
    request.max_output_tokens = 1024
    request.runtime_manifest = {
        "runtime": "langchain",
        "sourceType": "python_package",
        "entrypoint": "fake_weather_agent_with_provider:create_agent",
    }

    result = runtime.execute(request)

    assert result.status == "\u5df2\u5b8c\u6210"
    assert result.output_text == "Weather provider call completed."
    model_object = calls[0]["model"]
    assert isinstance(model_object, FakeChatOpenAI)
    assert model_object.kwargs == {
        "model": "deepseek-v4-pro",
        "api_key": "sk-test-inline-key",
        "temperature": 0,
        "max_tokens": 1024,
        "base_url": "https://api.deepseek.com",
    }
