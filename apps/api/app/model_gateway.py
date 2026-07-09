from dataclasses import dataclass
import os
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
        model_provider_id: str | None = None,
        model_provider: str = "openai-compatible",
        model_base_url: str = "",
        model_secret_ref: str = "",
        temperature: float = 0.2,
        max_output_tokens: int = 2000,
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
        model_provider_id: str | None = None,
        model_provider: str = "openai-compatible",
        model_base_url: str = "",
        model_secret_ref: str = "",
        temperature: float = 0.2,
        max_output_tokens: int = 2000,
    ) -> ModelResult:
        effective_base_url = model_base_url.strip() or self.settings.model_base_url
        effective_api_key = resolve_model_api_key(model_secret_ref)
        effective_api_key = effective_api_key or self.settings.model_api_key
        if not effective_api_key or not effective_base_url:
            raise ModelGatewayError("模型服务未配置")
        resolved_model = self.settings.model_default_model or model
        if not resolved_model:
            raise ModelGatewayError("模型名称未配置")
        endpoint = f"{effective_base_url.rstrip('/')}/chat/completions"
        try:
            response = httpx.post(
                endpoint,
                headers={
                    "Authorization": f"Bearer {effective_api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": resolved_model,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_input},
                    ],
                    "temperature": temperature,
                    "max_tokens": max_output_tokens,
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


def resolve_model_api_key(model_secret_ref: str, fallback: str = "") -> str:
    secret_ref = model_secret_ref.strip()
    if not secret_ref:
        return fallback
    env_value = os.environ.get(secret_ref, "")
    if env_value:
        return env_value
    if _looks_like_inline_api_key(secret_ref):
        return secret_ref
    return fallback


def _looks_like_inline_api_key(value: str) -> bool:
    return value.lower().startswith(("sk-", "sk_"))
