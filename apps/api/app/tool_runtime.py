import json
from dataclasses import dataclass
from time import perf_counter
from typing import Any, Protocol
from urllib.parse import urlparse

import httpx

from app.config import Settings


@dataclass(frozen=True)
class ToolRuntimeGatewayResult:
    output_summary: str
    raw_output: Any | None = None


class ToolRuntimeGatewayError(RuntimeError):
    pass


class HttpToolGateway(Protocol):
    def execute(
        self,
        *,
        config: dict,
        parameters: dict,
    ) -> ToolRuntimeGatewayResult:
        pass


class McpToolGateway(Protocol):
    def execute(
        self,
        *,
        config: dict,
        parameters: dict,
    ) -> ToolRuntimeGatewayResult:
        pass


class DisabledHttpToolGateway:
    def execute(
        self,
        *,
        config: dict,
        parameters: dict,
    ) -> ToolRuntimeGatewayResult:
        raise ToolRuntimeGatewayError("工具执行网关未配置")


class DisabledMcpToolGateway:
    def execute(
        self,
        *,
        config: dict,
        parameters: dict,
    ) -> ToolRuntimeGatewayResult:
        raise ToolRuntimeGatewayError("MCP Tool 网关未配置")


class HttpxToolGateway:
    def __init__(
        self,
        settings: Settings,
        *,
        client: httpx.Client | None = None,
    ):
        self.settings = settings
        self.client = client or httpx.Client()

    def execute(
        self,
        *,
        config: dict,
        parameters: dict,
    ) -> ToolRuntimeGatewayResult:
        method = str(config.get("method", "POST")).upper()
        url = str(config.get("url", "")).strip()
        self._validate_request(method, url)
        try:
            response = self._send(method, url, parameters)
            response.raise_for_status()
            raw_output = self._response_payload(response)
            return ToolRuntimeGatewayResult(
                output_summary=self._summarize(raw_output),
                raw_output=raw_output,
            )
        except ToolRuntimeGatewayError:
            raise
        except httpx.HTTPStatusError as error:
            raise ToolRuntimeGatewayError(
                f"HTTP Tool 请求失败（HTTP {error.response.status_code}）",
            ) from None
        except httpx.HTTPError:
            raise ToolRuntimeGatewayError("HTTP Tool 请求失败") from None

    def _validate_request(self, method: str, url: str) -> None:
        if method not in {"GET", "POST"}:
            raise ToolRuntimeGatewayError("HTTP Tool 仅支持 GET / POST")
        parsed = urlparse(url)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            raise ToolRuntimeGatewayError("HTTP Tool URL 无效")
        allowed_hosts = {host.lower() for host in self.settings.tool_http_allowed_hosts}
        if not allowed_hosts:
            raise ToolRuntimeGatewayError("HTTP Tool 允许名单未配置")
        if parsed.hostname.lower() not in allowed_hosts:
            raise ToolRuntimeGatewayError("HTTP Tool Host 不在允许名单内")

    def _send(self, method: str, url: str, parameters: dict) -> httpx.Response:
        if method == "GET":
            return self.client.get(
                url,
                params=parameters,
                timeout=self.settings.tool_http_timeout_seconds,
            )
        return self.client.post(
            url,
            json=parameters,
            timeout=self.settings.tool_http_timeout_seconds,
        )

    @staticmethod
    def _response_payload(response: httpx.Response) -> Any:
        content_type = response.headers.get("content-type", "")
        if "application/json" in content_type:
            return response.json()
        return response.text

    @staticmethod
    def _summarize(raw_output: Any) -> str:
        if isinstance(raw_output, str):
            summary = raw_output
        else:
            summary = json.dumps(raw_output, ensure_ascii=False, separators=(",", ":"))
        return summary[:1000]


@dataclass(frozen=True)
class ToolRuntimeResult:
    status: str
    input_summary: str
    output_summary: str
    error: str
    duration_ms: int


class ToolRuntimeExecutor:
    def __init__(
        self,
        http_gateway: HttpToolGateway,
        mcp_gateway: McpToolGateway | None = None,
    ):
        self.http_gateway = http_gateway
        self.mcp_gateway = mcp_gateway or DisabledMcpToolGateway()

    def execute_http(self, *, config: dict, parameters: dict) -> ToolRuntimeResult:
        return self._execute(self.http_gateway, config=config, parameters=parameters)

    def execute_mcp(self, *, config: dict, parameters: dict) -> ToolRuntimeResult:
        return self._execute(self.mcp_gateway, config=config, parameters=parameters)

    def _execute(
        self,
        gateway: HttpToolGateway | McpToolGateway,
        *,
        config: dict,
        parameters: dict,
    ) -> ToolRuntimeResult:
        started_at = perf_counter()
        input_summary = json.dumps(parameters, ensure_ascii=False)
        try:
            gateway_result = gateway.execute(
                config=config,
                parameters=parameters,
            )
            return ToolRuntimeResult(
                status="succeeded",
                input_summary=input_summary,
                output_summary=gateway_result.output_summary,
                error="",
                duration_ms=self._duration_ms(started_at),
            )
        except Exception:
            return ToolRuntimeResult(
                status="failed",
                input_summary=input_summary,
                output_summary="",
                error="工具执行失败，请稍后重试",
                duration_ms=self._duration_ms(started_at),
            )

    @staticmethod
    def _duration_ms(started_at: float) -> int:
        return max(0, int((perf_counter() - started_at) * 1000))
