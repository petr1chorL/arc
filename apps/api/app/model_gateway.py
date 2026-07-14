from dataclasses import dataclass
import os
from typing import Protocol

import httpx

from app.config import Settings
from app.runtime_security import is_allowed_model_base_url, is_valid_model_secret_ref


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
        if not effective_base_url:
            raise ModelGatewayError("模型服务未配置")
        if not is_allowed_model_base_url(
            effective_base_url,
            self.settings.model_allowed_hosts,
        ):
            raise ModelGatewayError("模型服务地址未获准")
        secret_ref = model_secret_ref.strip()
        if secret_ref:
            if not is_valid_model_secret_ref(secret_ref):
                raise ModelGatewayError("模型凭证引用无效")
            effective_api_key = resolve_model_api_key(secret_ref)
            if not effective_api_key:
                raise ModelGatewayError("模型资产对应的后端环境变量未配置")
        elif model_provider_id:
            raise ModelGatewayError("模型资产未配置后端密钥引用")
        else:
            effective_api_key = self.settings.model_api_key
        if not effective_api_key:
            raise ModelGatewayError("模型服务未配置")
        resolved_model = model.strip() or self.settings.model_default_model
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
    if not is_valid_model_secret_ref(secret_ref):
        return ""
    return os.environ.get(secret_ref, "")
