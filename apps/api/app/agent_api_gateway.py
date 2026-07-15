import asyncio
from collections.abc import Callable, Coroutine
from concurrent.futures import TimeoutError as FutureTimeoutError
from dataclasses import dataclass, field
import json
import math
import os
from threading import Event, Lock, Thread
from time import monotonic
from typing import Any, Protocol, TypeVar
from urllib.parse import urlsplit

import httpx

from app.agent_manifest import (
    REMOTE_AGENT_PROTOCOL_VERSION,
    SECRET_REF_PATTERN,
    is_structurally_valid_agent_api_url,
)
from app.config import Settings


RETRYABLE_STATUS_CODES = {429, 500, 502, 503, 504}
MAX_REPORTED_TOKENS = 2_000_000_000
MAX_REPORTED_TOTAL_TOKENS = 2_147_483_647
MAX_REPORTED_COST_USD = 1_000_000_000


class _TotalDeadlineExceeded(RuntimeError):
    pass


T = TypeVar("T")


class _AsyncHttpRunner:
    def __init__(self) -> None:
        self._lock = Lock()
        self._loop: asyncio.AbstractEventLoop | None = None
        self._thread: Thread | None = None

    def run(
        self,
        coroutine_factory: Callable[[], Coroutine[Any, Any, T]],
        *,
        deadline: float,
    ) -> T:
        loop = self._ensure_loop()
        future = asyncio.run_coroutine_threadsafe(coroutine_factory(), loop)
        remaining = deadline - monotonic()
        if remaining <= 0:
            future.cancel()
            raise _TotalDeadlineExceeded
        try:
            result = future.result(timeout=remaining)
        except FutureTimeoutError:
            future.cancel()
            raise _TotalDeadlineExceeded from None
        if monotonic() > deadline:
            future.cancel()
            raise _TotalDeadlineExceeded
        return result

    def _ensure_loop(self) -> asyncio.AbstractEventLoop:
        with self._lock:
            if (
                self._loop is not None
                and self._thread is not None
                and self._thread.is_alive()
            ):
                return self._loop
            ready = Event()
            loop = asyncio.new_event_loop()
            thread = Thread(
                target=self._serve,
                args=(loop, ready),
                name="arc-agent-api-http",
                daemon=True,
            )
            self._loop = loop
            self._thread = thread
            thread.start()
        ready.wait()
        return loop

    @staticmethod
    def _serve(loop: asyncio.AbstractEventLoop, ready: Event) -> None:
        asyncio.set_event_loop(loop)
        ready.set()
        loop.run_forever()


_ASYNC_HTTP_RUNNER = _AsyncHttpRunner()


class AgentApiGatewayError(RuntimeError):
    def __init__(self, message: str, *, retryable: bool = False):
        super().__init__(message)
        self.retryable = retryable


@dataclass(frozen=True)
class AgentApiGatewayResult:
    output_text: str
    model: str
    prompt_tokens: int
    completion_tokens: int
    cost_usd: float
    tool_calls: list[dict] = field(default_factory=list)


class AgentApiGateway(Protocol):
    def execute(
        self,
        *,
        endpoint_url: str,
        secret_ref: str,
        timeout_seconds: int,
        invocation_id: str,
        workspace_id: str,
        run_id: str,
        node_run_id: str,
        node_id: str,
        node_name: str,
        agent_id: str,
        agent_version: str,
        input_text: str,
        system_prompt: str,
        tools: list[str],
        skills: list[str],
        max_total_tokens: int,
    ) -> AgentApiGatewayResult:
        ...


class DisabledAgentApiGateway:
    def execute(self, **request) -> AgentApiGatewayResult:
        raise AgentApiGatewayError("远程 Agent API 网关未配置")


class HttpxAgentApiGateway:
    def __init__(
        self,
        settings: Settings,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
        runner: _AsyncHttpRunner = _ASYNC_HTTP_RUNNER,
    ):
        if transport is not None and not isinstance(transport, httpx.AsyncBaseTransport):
            raise TypeError("transport must implement httpx.AsyncBaseTransport")
        self.settings = settings
        self.transport = transport
        self.runner = runner

    def execute(
        self,
        *,
        endpoint_url: str,
        secret_ref: str,
        timeout_seconds: int,
        invocation_id: str,
        workspace_id: str,
        run_id: str,
        node_run_id: str,
        node_id: str,
        node_name: str,
        agent_id: str,
        agent_version: str,
        input_text: str,
        system_prompt: str,
        tools: list[str],
        skills: list[str],
        max_total_tokens: int,
    ) -> AgentApiGatewayResult:
        endpoint = endpoint_url.strip()
        normalized_secret_ref = secret_ref.strip()
        self._validate_binding(workspace_id, endpoint, normalized_secret_ref)
        token = self._resolve_secret(normalized_secret_ref)
        deadline = monotonic() + timeout_seconds
        payload = {
            "protocolVersion": REMOTE_AGENT_PROTOCOL_VERSION,
            "invocationId": invocation_id,
            "agent": {"id": agent_id, "version": agent_version},
            "run": {
                "id": run_id,
                "nodeRunId": node_run_id,
                "nodeId": node_id,
            },
            "input": input_text,
            "context": {
                "workspaceId": workspace_id,
                "nodeName": node_name,
                "systemPrompt": system_prompt,
                "tools": tools,
                "skills": skills,
            },
        }
        try:
            content = self.runner.run(
                lambda: self._request(
                    endpoint=endpoint,
                    token=token,
                    invocation_id=invocation_id,
                    run_id=run_id,
                    payload=payload,
                    deadline=deadline,
                ),
                deadline=deadline,
            )
        except _TotalDeadlineExceeded:
            raise AgentApiGatewayError(
                "远程 Agent 请求超时",
                retryable=True,
            ) from None
        except AgentApiGatewayError:
            raise
        except (httpx.TimeoutException, httpx.TransportError):
            raise AgentApiGatewayError(
                "远程 Agent 请求失败",
                retryable=True,
            ) from None
        except httpx.HTTPError:
            raise AgentApiGatewayError("远程 Agent 请求失败") from None
        return self._parse_response(content, invocation_id, max_total_tokens)

    async def _request(
        self,
        *,
        endpoint: str,
        token: str,
        invocation_id: str,
        run_id: str,
        payload: dict,
        deadline: float,
    ) -> bytes:
        remaining = deadline - monotonic()
        if remaining <= 0:
            raise _TotalDeadlineExceeded
        try:
            async with asyncio.timeout(remaining):
                async with httpx.AsyncClient(
                    transport=self.transport,
                    trust_env=False,
                    follow_redirects=False,
                ) as client:
                    async with client.stream(
                        "POST",
                        endpoint,
                        headers={
                            "Authorization": f"Bearer {token}",
                            "Content-Type": "application/json",
                            "Idempotency-Key": invocation_id,
                            "X-ARC-Trace-Id": run_id,
                        },
                        json=payload,
                        timeout=httpx.Timeout(remaining),
                        follow_redirects=False,
                    ) as response:
                        self._validate_status(response.status_code)
                        content_type = response.headers.get(
                            "content-type",
                            "",
                        ).lower()
                        if (
                            content_type.split(";", 1)[0].strip()
                            != "application/json"
                        ):
                            raise AgentApiGatewayError(
                                "远程 Agent 响应类型无效",
                            )
                        return await self._read_bounded_response(response)
        except TimeoutError:
            raise _TotalDeadlineExceeded from None

    def _validate_binding(
        self,
        workspace_id: str,
        endpoint_url: str,
        secret_ref: str,
    ) -> None:
        if not is_structurally_valid_agent_api_url(endpoint_url):
            raise AgentApiGatewayError("远程 Agent 地址未获准")
        hostname = urlsplit(endpoint_url).hostname
        allowed_bindings = {
            (
                allowed_workspace_id.strip(),
                host.strip().lower(),
                allowed_secret_ref.strip(),
            )
            for binding in self.settings.agent_api_allowed_bindings
            if "=" in binding
            for scoped_host, allowed_secret_ref in [binding.split("=", 1)]
            if "@" in scoped_host
            for allowed_workspace_id, host in [scoped_host.split("@", 1)]
            if allowed_workspace_id.strip() and host.strip() and allowed_secret_ref.strip()
        }
        normalized_hostname = hostname.lower() if hostname else ""
        allowed_hosts = {
            host
            for allowed_workspace_id, host, _ in allowed_bindings
            if allowed_workspace_id == workspace_id
        }
        if not normalized_hostname or normalized_hostname not in allowed_hosts:
            raise AgentApiGatewayError("远程 Agent 地址未获准")
        if (workspace_id, normalized_hostname, secret_ref) not in allowed_bindings:
            raise AgentApiGatewayError("远程 Agent 地址与凭证未获准")

    @staticmethod
    def _resolve_secret(secret_ref: str) -> str:
        normalized_ref = secret_ref.strip()
        if not SECRET_REF_PATTERN.fullmatch(normalized_ref):
            raise AgentApiGatewayError("远程 Agent 凭证引用无效")
        token = os.environ.get(normalized_ref, "")
        if not token:
            raise AgentApiGatewayError("远程 Agent 凭证未配置")
        return token

    @staticmethod
    def _validate_status(status_code: int) -> None:
        if status_code == 200:
            return
        if status_code in RETRYABLE_STATUS_CODES:
            raise AgentApiGatewayError(
                "远程 Agent 请求失败",
                retryable=True,
            )
        raise AgentApiGatewayError("远程 Agent 请求失败")

    async def _read_bounded_response(
        self,
        response: httpx.Response,
    ) -> bytes:
        chunks: list[bytes] = []
        size = 0
        async for chunk in response.aiter_bytes():
            size += len(chunk)
            if size > self.settings.agent_api_max_response_bytes:
                raise AgentApiGatewayError("远程 Agent 响应过大")
            chunks.append(chunk)
        return b"".join(chunks)

    @staticmethod
    def _parse_response(
        content: bytes,
        invocation_id: str,
        max_total_tokens: int,
    ) -> AgentApiGatewayResult:
        try:
            payload = json.loads(content.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise AgentApiGatewayError("远程 Agent 响应协议无效") from None
        if not isinstance(payload, dict) or set(payload) != {
            "protocolVersion",
            "invocationId",
            "output",
            "usage",
            "toolCalls",
        }:
            raise AgentApiGatewayError("远程 Agent 响应协议无效")
        if payload.get("protocolVersion") != REMOTE_AGENT_PROTOCOL_VERSION:
            raise AgentApiGatewayError("远程 Agent 响应协议无效")
        if payload.get("invocationId") != invocation_id:
            raise AgentApiGatewayError("远程 Agent 响应标识不匹配")

        output = payload.get("output")
        if not isinstance(output, str) or not output.strip():
            raise AgentApiGatewayError("远程 Agent 响应协议无效")
        usage = payload.get("usage")
        if not isinstance(usage, dict) or not set(usage).issubset({
            "model",
            "promptTokens",
            "completionTokens",
            "costUsd",
        }):
            raise AgentApiGatewayError("远程 Agent 响应协议无效")
        model = usage.get("model", "")
        if not isinstance(model, str) or len(model) > 120:
            raise AgentApiGatewayError("远程 Agent 响应协议无效")
        prompt_tokens = _nonnegative_int(usage.get("promptTokens", 0))
        completion_tokens = _nonnegative_int(usage.get("completionTokens", 0))
        if (
            prompt_tokens + completion_tokens > MAX_REPORTED_TOTAL_TOKENS
            or prompt_tokens + completion_tokens > max_total_tokens
        ):
            raise AgentApiGatewayError("远程 Agent 响应协议无效")
        cost_usd = _nonnegative_float(usage.get("costUsd", 0))

        tool_calls = payload.get("toolCalls")
        if (
            not isinstance(tool_calls, list)
            or len(tool_calls) > 100
            or any(not isinstance(item, dict) for item in tool_calls)
        ):
            raise AgentApiGatewayError("远程 Agent 响应协议无效")
        return AgentApiGatewayResult(
            output_text=output.strip(),
            model=model.strip(),
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            cost_usd=cost_usd,
            tool_calls=tool_calls,
        )


def _nonnegative_int(value: object) -> int:
    if (
        isinstance(value, bool)
        or not isinstance(value, int)
        or value < 0
        or value > MAX_REPORTED_TOKENS
    ):
        raise AgentApiGatewayError("远程 Agent 响应协议无效")
    return value


def _nonnegative_float(value: object) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise AgentApiGatewayError("远程 Agent 响应协议无效")
    normalized = float(value)
    if not math.isfinite(normalized) or not 0 <= normalized <= MAX_REPORTED_COST_USD:
        raise AgentApiGatewayError("远程 Agent 响应协议无效")
    return normalized
