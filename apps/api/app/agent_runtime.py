from collections.abc import Callable
from dataclasses import dataclass, field
from time import perf_counter

from app.model_gateway import ModelGateway


STATUS_COMPLETED = "\u5df2\u5b8c\u6210"
STATUS_FAILED = "\u5931\u8d25"
RUNTIME_FAILURE_MESSAGE = "\u0041gent \u6267\u884c\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5"
EMPTY_OUTPUT_FAILURE_MESSAGE = (
    "\u6a21\u578b\u672a\u8fd4\u56de\u6709\u6548\u5185\u5bb9\uff0c\u0041gent \u6267\u884c\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5"
)
MODEL_CREDENTIAL_FAILURE_MESSAGE = (
    "\u004cangChain \u8fd0\u884c\u65f6\u7f3a\u5c11\u6a21\u578b\u51ed\u8bc1\uff0c"
    "\u8bf7\u5728\u6a21\u578b\u8d44\u4ea7\u6216\u73af\u5883\u53d8\u91cf\u4e2d\u914d\u7f6e\u540e\u91cd\u8bd5"
)
PYTHON_PACKAGE_EXECUTION_DISABLED_MESSAGE = (
    "Python Package 当前仅登记元数据，尚未接入隔离执行器"
)


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
    model_provider_id: str | None = None
    model_provider: str = "openai-compatible"
    model_base_url: str = ""
    model_secret_ref: str = ""
    temperature: float = 0.2
    max_output_tokens: int = 2000
    tools: list[str] = field(default_factory=list)
    skills: list[str] = field(default_factory=list)
    runtime_manifest: dict = field(default_factory=dict)


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
        if _is_langchain_python_package(request.runtime_manifest):
            return AgentRuntimeResult(
                status=STATUS_FAILED,
                output_text="",
                error=PYTHON_PACKAGE_EXECUTION_DISABLED_MESSAGE,
                model="",
                prompt_tokens=0,
                completion_tokens=0,
                total_tokens=0,
                cost_usd=0,
                score=0,
                attempts=1,
                duration_ms=int((perf_counter() - started) * 1000),
                tool_calls=[],
            )
        attempts = 0
        last_error: Exception | None = None
        last_attempt_was_blank = False
        for attempt in range(1, max_attempts + 1):
            attempts = attempt
            try:
                model_result = self.gateway.complete(
                    system_prompt=request.system_prompt,
                    user_input=request.input_text,
                    model=request.model,
                    model_provider_id=request.model_provider_id,
                    model_provider=request.model_provider,
                    model_base_url=request.model_base_url,
                    model_secret_ref=request.model_secret_ref,
                    temperature=request.temperature,
                    max_output_tokens=request.max_output_tokens,
                )
                if not model_result.content or not model_result.content.strip():
                    last_error = None
                    last_attempt_was_blank = True
                    continue
                last_attempt_was_blank = False
                total_tokens = model_result.prompt_tokens + model_result.completion_tokens
                return AgentRuntimeResult(
                    status=STATUS_COMPLETED,
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
            except Exception as exc:
                last_error = exc
                last_attempt_was_blank = False
                continue
        return AgentRuntimeResult(
            status=STATUS_FAILED,
            output_text="",
            error=(
                EMPTY_OUTPUT_FAILURE_MESSAGE
                if last_attempt_was_blank
                else _runtime_error_message(last_error)
            ),
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


def _is_langchain_python_package(manifest: dict) -> bool:
    return (
        manifest.get("runtime") == "langchain"
        and manifest.get("sourceType") == "python_package"
        and bool(manifest.get("entrypoint"))
    )


def _runtime_error_message(error: Exception | None) -> str:
    if error is None:
        return RUNTIME_FAILURE_MESSAGE
    message = str(error).lower()
    if "missing credentials" in message or "api_key" in message or "openai_api_key" in message:
        return MODEL_CREDENTIAL_FAILURE_MESSAGE
    return RUNTIME_FAILURE_MESSAGE
