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

    assert result.status == "已完成"
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

    assert result.status == "失败"
    assert result.output_text == ""
    assert result.error == "Agent 执行失败，请稍后重试"
    assert result.model == ""
    assert result.prompt_tokens == 0
    assert result.completion_tokens == 0
    assert result.total_tokens == 0
    assert result.cost_usd == 0
    assert result.score == 0
    assert result.attempts == 2
    assert result.tool_calls == []
    assert "provider-secret-detail" not in result.error
