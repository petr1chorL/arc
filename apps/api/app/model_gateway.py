from dataclasses import dataclass
from typing import Protocol

import httpx

from app.config import Settings


class ModelGatewayError(RuntimeError):
    pass


@dataclass
class ModelResult:
    content: str
    model: str
    prompt_tokens: int
    completion_tokens: int


class ModelGateway(Protocol):
    def complete(
        self,
        *,
        system_prompt: str,
        user_input: str,
        model: str,
    ) -> ModelResult:
        ...


class OpenAICompatibleGateway:
    def __init__(self, settings: Settings):
        self.settings = settings

    def complete(
        self,
        *,
        system_prompt: str,
        user_input: str,
        model: str,
    ) -> ModelResult:
        if not self.settings.model_api_key or not self.settings.model_base_url:
            raise ModelGatewayError("模型服务未配置")
        resolved_model = self.settings.model_default_model or model
        if not resolved_model:
            raise ModelGatewayError("模型名称未配置")
        endpoint = f"{self.settings.model_base_url.rstrip('/')}/chat/completions"
        try:
            response = httpx.post(
                endpoint,
                headers={
                    "Authorization": f"Bearer {self.settings.model_api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": resolved_model,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_input},
                    ],
                    "temperature": 0.2,
                },
                timeout=self.settings.model_timeout_seconds,
            )
            response.raise_for_status()
            payload = response.json()
            usage = payload.get("usage", {})
            return ModelResult(
                content=payload["choices"][0]["message"]["content"],
                model=payload.get("model", resolved_model),
                prompt_tokens=int(usage.get("prompt_tokens", 0)),
                completion_tokens=int(usage.get("completion_tokens", 0)),
            )
        except httpx.HTTPStatusError as error:
            raise ModelGatewayError(
                f"模型服务请求失败（HTTP {error.response.status_code}）",
            ) from None
        except (httpx.HTTPError, KeyError, TypeError, ValueError):
            raise ModelGatewayError("模型服务请求失败") from None
