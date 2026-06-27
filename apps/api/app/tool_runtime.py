import json
from dataclasses import dataclass
from time import perf_counter
from typing import Any, Protocol


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


class DisabledHttpToolGateway:
    def execute(
        self,
        *,
        config: dict,
        parameters: dict,
    ) -> ToolRuntimeGatewayResult:
        raise ToolRuntimeGatewayError("工具执行网关未配置")


@dataclass(frozen=True)
class ToolRuntimeResult:
    status: str
    input_summary: str
    output_summary: str
    error: str
    duration_ms: int


class ToolRuntimeExecutor:
    def __init__(self, gateway: HttpToolGateway):
        self.gateway = gateway

    def execute_http(self, *, config: dict, parameters: dict) -> ToolRuntimeResult:
        started_at = perf_counter()
        input_summary = json.dumps(parameters, ensure_ascii=False)
        try:
            gateway_result = self.gateway.execute(
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
