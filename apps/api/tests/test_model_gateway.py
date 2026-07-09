import httpx

from app.config import Settings
from app.model_gateway import OpenAICompatibleGateway


def test_deepseek_gateway_uses_project_defaults_and_parses_usage(monkeypatch):
    captured: dict = {}

    def fake_post(url, *, headers, json, timeout):
        captured.update({
            "url": url,
            "headers": headers,
            "json": json,
            "timeout": timeout,
        })
        return httpx.Response(
            200,
            request=httpx.Request("POST", url),
            json={
                "model": "deepseek-v4-pro",
                "choices": [{"message": {"content": "结构化执行结果"}}],
                "usage": {"prompt_tokens": 21, "completion_tokens": 9},
            },
        )

    monkeypatch.setattr(httpx, "post", fake_post)
    settings = Settings(model_api_key="test-key")

    result = OpenAICompatibleGateway(settings).complete(
        system_prompt="只输出结构化结果",
        user_input="分析新品机会",
        model="ignored-agent-model",
    )

    assert captured["url"] == "https://api.deepseek.com/chat/completions"
    assert captured["json"]["model"] == "deepseek-v4-pro"
    assert captured["json"]["messages"] == [
        {"role": "system", "content": "只输出结构化结果"},
        {"role": "user", "content": "分析新品机会"},
    ]
    assert captured["headers"]["Authorization"] == "Bearer test-key"
    assert result.content == "结构化执行结果"
    assert result.prompt_tokens == 21
    assert result.completion_tokens == 9


def test_gateway_resolves_provider_secret_ref_at_call_boundary(monkeypatch):
    captured: dict = {}

    def fake_post(url, *, headers, json, timeout):
        captured.update({
            "url": url,
            "headers": headers,
            "json": json,
            "timeout": timeout,
        })
        return httpx.Response(
            200,
            request=httpx.Request("POST", url),
            json={
                "model": "deepseek-v4-pro",
                "choices": [{"message": {"content": "结构化执行结果"}}],
                "usage": {"prompt_tokens": 8, "completion_tokens": 5},
            },
        )

    monkeypatch.setattr(httpx, "post", fake_post)
    monkeypatch.setenv("PROVIDER_API_KEY_FOR_TEST", "provider-key-value")
    settings = Settings(model_api_key="", model_base_url="")

    result = OpenAICompatibleGateway(settings).complete(
        system_prompt="只输出结构化结果",
        user_input="分析新品机会",
        model="deepseek-v4-pro",
        model_base_url="https://api.deepseek.com",
        model_secret_ref="PROVIDER_API_KEY_FOR_TEST",
    )

    assert captured["headers"]["Authorization"] == "Bearer provider-key-value"
    assert result.content == "结构化执行结果"
def test_gateway_accepts_inline_key_for_local_prototype(monkeypatch):
    captured: dict = {}

    def fake_post(url, *, headers, json, timeout):
        captured.update({"headers": headers})
        return httpx.Response(
            200,
            request=httpx.Request("POST", url),
            json={
                "model": "deepseek-v4-pro",
                "choices": [{"message": {"content": "ok"}}],
                "usage": {"prompt_tokens": 1, "completion_tokens": 1},
            },
        )

    monkeypatch.setattr(httpx, "post", fake_post)
    settings = Settings(model_api_key="", model_base_url="")

    OpenAICompatibleGateway(settings).complete(
        system_prompt="system",
        user_input="input",
        model="deepseek-v4-pro",
        model_base_url="https://api.deepseek.com",
        model_secret_ref="sk-test-inline-key",
    )

    assert captured["headers"]["Authorization"] == "Bearer sk-test-inline-key"
