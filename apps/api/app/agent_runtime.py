from collections.abc import Callable
from dataclasses import dataclass, field
from importlib import import_module
from pathlib import Path
import sys
from time import perf_counter

from app.model_gateway import ModelGateway, resolve_model_api_key


STATUS_COMPLETED = "\u5df2\u5b8c\u6210"
STATUS_FAILED = "\u5931\u8d25"
RUNTIME_FAILURE_MESSAGE = "\u0041gent \u6267\u884c\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5"
MODEL_CREDENTIAL_FAILURE_MESSAGE = (
    "\u004cangChain \u8fd0\u884c\u65f6\u7f3a\u5c11\u6a21\u578b\u51ed\u8bc1\uff0c"
    "\u8bf7\u5728\u6a21\u578b\u8d44\u4ea7\u6216\u73af\u5883\u53d8\u91cf\u4e2d\u914d\u7f6e\u540e\u91cd\u8bd5"
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
        attempts = 0
        last_error: Exception | None = None
        for attempt in range(1, max_attempts + 1):
            attempts = attempt
            try:
                if _is_langchain_python_package(request.runtime_manifest):
                    return self._execute_langchain_package(
                        request=request,
                        attempts=attempt,
                        started=started,
                    )
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
                continue
        return AgentRuntimeResult(
            status=STATUS_FAILED,
            output_text="",
            error=_runtime_error_message(last_error),
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

    def _execute_langchain_package(
        self,
        *,
        request: AgentRuntimeRequest,
        attempts: int,
        started: float,
    ) -> AgentRuntimeResult:
        entrypoint = str(request.runtime_manifest.get("entrypoint", "")).strip()
        if ":" not in entrypoint:
            raise RuntimeError("invalid package entrypoint")
        package_source = str(request.runtime_manifest.get("packageSource", "")).strip()
        if package_source:
            source_path = Path(package_source)
            if source_path.exists():
                source_path_text = str(source_path)
                if source_path_text not in sys.path:
                    sys.path.insert(0, source_path_text)
        module_name, factory_name = entrypoint.split(":", 1)
        module = import_module(module_name)
        factory = getattr(module, factory_name)
        agent = factory(
            model=_langchain_model(request),
            system_prompt=request.system_prompt,
        )
        output = _invoke_langchain_agent(agent, request.input_text)
        output_text = _extract_langchain_output(output)
        if not output_text:
            raise RuntimeError("empty package runtime output")
        return AgentRuntimeResult(
            status=STATUS_COMPLETED,
            output_text=output_text,
            error="",
            model=request.model,
            prompt_tokens=0,
            completion_tokens=0,
            total_tokens=0,
            cost_usd=0,
            score=quality_score(output_text),
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


def _langchain_model(request: AgentRuntimeRequest) -> object:
    api_key = resolve_model_api_key(request.model_secret_ref)
    if request.model_provider != "openai-compatible" or not api_key:
        return request.model
    try:
        from langchain_openai import ChatOpenAI
    except ImportError as exc:
        raise RuntimeError("langchain-openai is not installed") from exc
    model_name = request.model.removeprefix("openai:")
    kwargs: dict[str, object] = {
        "model": model_name,
        "api_key": api_key,
        "temperature": request.temperature,
        "max_tokens": request.max_output_tokens,
    }
    if request.model_base_url:
        kwargs["base_url"] = request.model_base_url
    return ChatOpenAI(**kwargs)


def _invoke_langchain_agent(agent: object, input_text: str) -> object:
    if hasattr(agent, "invoke"):
        invoke = getattr(agent, "invoke")
        try:
            return invoke({"messages": [{"role": "user", "content": input_text}]})
        except TypeError:
            return invoke({"input": input_text})
    if callable(agent):
        return agent(input_text)
    raise RuntimeError("package entrypoint did not return an invokable agent")


def _extract_langchain_output(output: object) -> str:
    if isinstance(output, str):
        return output.strip()
    if isinstance(output, dict):
        for key in ("output", "content", "text", "final"):
            value = output.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        messages = output.get("messages")
        if isinstance(messages, list):
            for message in reversed(messages):
                content = None
                if isinstance(message, dict):
                    content = message.get("content")
                else:
                    content = getattr(message, "content", None)
                if isinstance(content, str) and content.strip():
                    return content.strip()
                if isinstance(content, list):
                    text_parts = [
                        item.get("text", "")
                        for item in content
                        if isinstance(item, dict) and isinstance(item.get("text"), str)
                    ]
                    joined = "\n".join(part for part in text_parts if part.strip())
                    if joined.strip():
                        return joined.strip()
    content = getattr(output, "content", None)
    if isinstance(content, str) and content.strip():
        return content.strip()
    return ""


def _runtime_error_message(error: Exception | None) -> str:
    if error is None:
        return RUNTIME_FAILURE_MESSAGE
    message = str(error).lower()
    if "missing credentials" in message or "api_key" in message or "openai_api_key" in message:
        return MODEL_CREDENTIAL_FAILURE_MESSAGE
    return RUNTIME_FAILURE_MESSAGE
