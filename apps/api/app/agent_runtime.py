from collections.abc import Callable
from dataclasses import dataclass, field
from time import perf_counter

from app.model_gateway import ModelGateway


def quality_score(output: str) -> int:
    length = len(output.strip())
    if length == 0:
        return 0
    if length < 20:
        return 50
    return 100


@dataclass
class AgentRuntimeRequest:
    workspace_id: str
    run_id: str
    node_id: str
    node_name: str
    agent_id: str
    agent_version: str
    input_text: str
    system_prompt: str
    model: str
    tools: list[str] = field(default_factory=list)
    skills: list[str] = field(default_factory=list)


@dataclass
class AgentRuntimeResult:
    status: str
    output_text: str
    error: str
    model: str
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    cost_usd: float
    score: int
    attempts: int
    duration_ms: int
    tool_calls: list[dict] = field(default_factory=list)


class AgentRuntimeExecutor:
    def __init__(
        self,
        *,
        gateway: ModelGateway,
        cost_calculator: Callable[[int, int], float],
    ):
        self.gateway = gateway
        self.cost_calculator = cost_calculator

    def execute(
        self,
        request: AgentRuntimeRequest,
        *,
        max_attempts: int = 2,
    ) -> AgentRuntimeResult:
        started = perf_counter()
        attempts = 0
        for attempt in range(1, max_attempts + 1):
            attempts = attempt
            try:
                model_result = self.gateway.complete(
                    system_prompt=request.system_prompt,
                    user_input=request.input_text,
                    model=request.model,
                )
                total_tokens = model_result.prompt_tokens + model_result.completion_tokens
                return AgentRuntimeResult(
                    status="已完成",
                    output_text=model_result.content,
                    error="",
                    model=model_result.model,
                    prompt_tokens=model_result.prompt_tokens,
                    completion_tokens=model_result.completion_tokens,
                    total_tokens=total_tokens,
                    cost_usd=self.cost_calculator(
                        model_result.prompt_tokens,
                        model_result.completion_tokens,
                    ),
                    score=quality_score(model_result.content),
                    attempts=attempt,
                    duration_ms=int((perf_counter() - started) * 1000),
                    tool_calls=[],
                )
            except Exception:
                continue
        return AgentRuntimeResult(
            status="失败",
            output_text="",
            error="Agent 执行失败，请稍后重试",
            model="",
            prompt_tokens=0,
            completion_tokens=0,
            total_tokens=0,
            cost_usd=0,
            score=0,
            attempts=attempts,
            duration_ms=int((perf_counter() - started) * 1000),
            tool_calls=[],
        )
