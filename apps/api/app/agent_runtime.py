from collections.abc import Callable
from dataclasses import dataclass, field
from time import perf_counter

from app.agent_api_gateway import (
    AgentApiGateway,
    AgentApiGatewayError,
    DisabledAgentApiGateway,
)
from app.agent_manifest import (
    is_remote_agent_api_manifest,
    normalize_agent_runtime_manifest,
)
from app.model_gateway import ModelGateway


STATUS_COMPLETED = "已完成"
STATUS_FAILED = "失败"
RUNTIME_FAILURE_MESSAGE = "Agent 执行失败，请稍后重试"
EMPTY_OUTPUT_FAILURE_MESSAGE = "模型未返回有效内容，Agent 执行失败，请稍后重试"
MODEL_CREDENTIAL_FAILURE_MESSAGE = (
    "LangChain 运行时缺少模型凭证，"
    "请在模型资产或环境变量中配置后重试"
)
UNSUPPORTED_RUNTIME_MESSAGE = "该 Agent 使用已停止支持的运行方式，请改为远程 Agent API"
REMOTE_AGENT_FAILURE_MESSAGE = "远程 Agent API 执行失败，请稍后重试"
MAX_RUNTIME_ATTEMPTS = 3
MAX_TOTAL_TOKENS = 2_147_483_647


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
    max_total_tokens: int = MAX_TOTAL_TOKENS
    tools: list[str] = field(default_factory=list)
    skills: list[str] = field(default_factory=list)
    runtime_manifest: dict = field(default_factory=dict)
    invocation_id: str = ""
    node_run_id: str = ""


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
        agent_api_gateway: AgentApiGateway | None = None,
    ):
        self.gateway = gateway
        self.agent_api_gateway = agent_api_gateway or DisabledAgentApiGateway()
        self.cost_calculator = cost_calculator

    def execute(
        self,
        request: AgentRuntimeRequest,
        *,
        max_attempts: int = 2,
    ) -> AgentRuntimeResult:
        bounded_attempts = (
            min(max_attempts, MAX_RUNTIME_ATTEMPTS)
            if type(max_attempts) is int and max_attempts > 0
            else 1
        )
        started = perf_counter()
        if request.runtime_manifest:
            if not is_remote_agent_api_manifest(request.runtime_manifest):
                return self._failure(
                    started=started,
                    error=UNSUPPORTED_RUNTIME_MESSAGE,
                    attempts=1,
                )
            try:
                manifest = normalize_agent_runtime_manifest(request.runtime_manifest)
            except ValueError:
                return self._failure(
                    started=started,
                    error=UNSUPPORTED_RUNTIME_MESSAGE,
                    attempts=1,
                )
            return self._execute_remote(
                request,
                manifest=manifest,
                max_attempts=bounded_attempts,
                started=started,
            )
        return self._execute_model(
            request,
            max_attempts=bounded_attempts,
            started=started,
        )

    def _execute_remote(
        self,
        request: AgentRuntimeRequest,
        *,
        manifest: dict,
        max_attempts: int,
        started: float,
    ) -> AgentRuntimeResult:
        if not request.invocation_id or not request.node_run_id:
            return self._failure(
                started=started,
                error=REMOTE_AGENT_FAILURE_MESSAGE,
                attempts=1,
            )
        if not _is_valid_token_budget(request.max_total_tokens):
            return self._failure(
                started=started,
                error=REMOTE_AGENT_FAILURE_MESSAGE,
                attempts=1,
            )
        attempts = 0
        for attempt in range(1, max_attempts + 1):
            attempts = attempt
            try:
                remote_result = self.agent_api_gateway.execute(
                    endpoint_url=manifest["endpointUrl"],
                    secret_ref=manifest["secretRef"],
                    timeout_seconds=manifest["timeoutSeconds"],
                    invocation_id=request.invocation_id,
                    workspace_id=request.workspace_id,
                    run_id=request.run_id,
                    node_run_id=request.node_run_id,
                    node_id=request.node_id,
                    node_name=request.node_name,
                    agent_id=request.agent_id,
                    agent_version=request.agent_version,
                    input_text=request.input_text,
                    system_prompt=request.system_prompt,
                    tools=request.tools,
                    skills=request.skills,
                    max_total_tokens=request.max_total_tokens,
                )
                if not _is_valid_remote_token_usage(
                    remote_result.prompt_tokens,
                    remote_result.completion_tokens,
                    request.max_total_tokens,
                ):
                    return self._failure(
                        started=started,
                        error=REMOTE_AGENT_FAILURE_MESSAGE,
                        attempts=attempt,
                    )
                output_text = remote_result.output_text.strip()
                if not output_text:
                    return self._failure(
                        started=started,
                        error=REMOTE_AGENT_FAILURE_MESSAGE,
                        attempts=attempt,
                    )
                total_tokens = (
                    remote_result.prompt_tokens
                    + remote_result.completion_tokens
                )
                return AgentRuntimeResult(
                    status=STATUS_COMPLETED,
                    output_text=output_text,
                    error="",
                    model=remote_result.model,
                    prompt_tokens=remote_result.prompt_tokens,
                    completion_tokens=remote_result.completion_tokens,
                    total_tokens=total_tokens,
                    cost_usd=remote_result.cost_usd,
                    score=quality_score(output_text),
                    attempts=attempt,
                    duration_ms=int((perf_counter() - started) * 1000),
                    tool_calls=remote_result.tool_calls or [],
                )
            except AgentApiGatewayError as error:
                if not error.retryable:
                    break
            except Exception:
                break
        return self._failure(
            started=started,
            error=REMOTE_AGENT_FAILURE_MESSAGE,
            attempts=max(attempts, 1),
        )

    def _execute_model(
        self,
        request: AgentRuntimeRequest,
        *,
        max_attempts: int,
        started: float,
    ) -> AgentRuntimeResult:
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
        return self._failure(
            started=started,
            error=(
                EMPTY_OUTPUT_FAILURE_MESSAGE
                if last_attempt_was_blank
                else _runtime_error_message(last_error)
            ),
            attempts=attempts,
        )

    @staticmethod
    def _failure(
        *,
        started: float,
        error: str,
        attempts: int,
    ) -> AgentRuntimeResult:
        return AgentRuntimeResult(
            status=STATUS_FAILED,
            output_text="",
            error=error,
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


def _is_valid_token_budget(max_total_tokens: object) -> bool:
    return (
        type(max_total_tokens) is int
        and 0 <= max_total_tokens <= MAX_TOTAL_TOKENS
    )


def _is_valid_remote_token_usage(
    prompt_tokens: object,
    completion_tokens: object,
    max_total_tokens: int,
) -> bool:
    return (
        type(prompt_tokens) is int
        and type(completion_tokens) is int
        and prompt_tokens >= 0
        and completion_tokens >= 0
        and prompt_tokens <= max_total_tokens
        and completion_tokens <= max_total_tokens - prompt_tokens
    )


def _runtime_error_message(error: Exception | None) -> str:
    if error is None:
        return RUNTIME_FAILURE_MESSAGE
    message = str(error).lower()
    if "missing credentials" in message or "api_key" in message or "openai_api_key" in message:
        return MODEL_CREDENTIAL_FAILURE_MESSAGE
    return RUNTIME_FAILURE_MESSAGE
