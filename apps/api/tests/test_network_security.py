from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


def test_settings_accept_comma_separated_allowlists(monkeypatch):
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://one.example, https://two.example")
    monkeypatch.setenv("ALLOWED_HOSTS", "api.example.com, localhost")

    settings = Settings()

    assert settings.allowed_origins == ("https://one.example", "https://two.example")
    assert settings.allowed_hosts == ("api.example.com", "localhost")


def test_health_check_and_security_headers(tmp_path):
    settings = Settings(
        allowed_hosts=["testserver"],
        hsts_enabled=True,
    )
    client = TestClient(
        create_app(
            f"sqlite:///{tmp_path / 'network-security.db'}",
            settings=settings,
        ),
    )

    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "DENY"
    assert response.headers["referrer-policy"] == "no-referrer"
    assert response.headers["permissions-policy"] == "geolocation=(), microphone=(), camera=()"
    assert response.headers["strict-transport-security"] == "max-age=31536000; includeSubDomains"


def test_cors_allows_only_configured_frontend_origin(tmp_path):
    settings = Settings(
        allowed_origins=["https://arc-one.pages.dev"],
        allowed_hosts=["testserver"],
    )
    client = TestClient(
        create_app(
            f"sqlite:///{tmp_path / 'cors.db'}",
            settings=settings,
        ),
    )

    allowed = client.options(
        "/api/agents",
        headers={
            "Origin": "https://arc-one.pages.dev",
            "Access-Control-Request-Method": "GET",
        },
    )
    denied = client.options(
        "/api/agents",
        headers={
            "Origin": "https://evil.example",
            "Access-Control-Request-Method": "GET",
        },
    )

    assert allowed.status_code == 200
    assert allowed.headers["access-control-allow-origin"] == "https://arc-one.pages.dev"
    assert allowed.headers["access-control-allow-credentials"] == "true"
    assert denied.status_code == 400
    assert "access-control-allow-origin" not in denied.headers


def test_untrusted_host_is_rejected(tmp_path):
    settings = Settings(allowed_hosts=["api.example.com"])
    client = TestClient(
        create_app(
            f"sqlite:///{tmp_path / 'trusted-host.db'}",
            settings=settings,
        ),
    )

    response = client.get("/api/health", headers={"host": "attacker.example"})

    assert response.status_code == 400


def test_request_body_limit_rejects_oversized_payload(tmp_path):
    settings = Settings(
        allowed_hosts=["testserver"],
        max_request_body_bytes=10,
    )
    client = TestClient(
        create_app(
            f"sqlite:///{tmp_path / 'body-limit.db'}",
            settings=settings,
        ),
    )

    response = client.post(
        "/api/agents",
        content='{"name":"too large"}',
        headers={"Content-Type": "application/json"},
    )

    assert response.status_code == 413
    assert response.json() == {"detail": "请求体过大"}


def test_request_body_limit_allows_small_payload(tmp_path):
    settings = Settings(
        allowed_hosts=["testserver"],
        max_request_body_bytes=10_000,
    )
    client = TestClient(
        create_app(
            f"sqlite:///{tmp_path / 'body-limit-ok.db'}",
            settings=settings,
        ),
    )

    response = client.post(
        "/api/body-limit-probe",
        json={"name": "安全测试"},
    )

    assert response.status_code == 404


def test_rate_limit_rejects_excessive_requests_from_same_client(tmp_path):
    settings = Settings(
        allowed_hosts=["testserver"],
        rate_limit_requests=2,
        rate_limit_window_seconds=60,
    )
    client = TestClient(
        create_app(
            f"sqlite:///{tmp_path / 'rate-limit.db'}",
            settings=settings,
        ),
    )

    assert client.get("/api/rate-limit-probe").status_code == 404
    assert client.get("/api/rate-limit-probe").status_code == 404
    response = client.get("/api/rate-limit-probe")

    assert response.status_code == 429
    assert response.json() == {"detail": "请求过于频繁"}
    assert response.headers["retry-after"] == "60"


def test_production_requires_explicit_network_and_secret_configuration(tmp_path):
    settings = Settings(
        environment="production",
        model_api_key="",
        rate_limit_enabled=False,
    )

    try:
        create_app(f"sqlite:///{tmp_path / 'unsafe-production.db'}", settings=settings)
    except RuntimeError as error:
        message = str(error)
    else:
        raise AssertionError("production settings should reject unsafe defaults")

    assert "DATABASE_URL must use PostgreSQL" in message
    assert "ALLOWED_ORIGINS must be empty or contain only HTTPS origins" in message
    assert "ALLOWED_HOSTS must include the public API host" in message
    assert "HSTS_ENABLED must be true" in message
    assert "COOKIE_SECURE must be true" in message
    assert "RATE_LIMIT_ENABLED must be true" in message


def test_production_accepts_explicit_safe_configuration():
    settings = Settings(
        environment="production",
        database_url="postgresql+psycopg://user:password@db.example.com:5432/arc_one",
        allowed_origins=[],
        allowed_hosts=["arc-one-api.onrender.com"],
        hsts_enabled=True,
        cookie_secure=True,
    )

    settings.validate_production_ready(
        "postgresql+psycopg://user:password@db.example.com:5432/arc_one",
    )
