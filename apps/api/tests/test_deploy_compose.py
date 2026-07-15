import json
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[3]


def test_compose_defines_api_and_execution_worker_services():
    compose = yaml.safe_load((ROOT / "compose.yaml").read_text(encoding="utf-8"))
    services = compose["services"]

    assert "api" in services
    assert "execution-worker" in services

    api = services["api"]
    worker = services["execution-worker"]
    assert api["build"]["context"] == "./apps/api"
    assert worker["build"] == api["build"]
    assert api["environment"]["DATABASE_URL"].startswith("postgresql+psycopg://")
    assert worker["environment"]["DATABASE_URL"] == api["environment"]["DATABASE_URL"]
    assert api["depends_on"]["postgres"]["condition"] == "service_healthy"
    assert worker["depends_on"]["postgres"]["condition"] == "service_healthy"
    assert "uvicorn" in " ".join(api["command"])
    assert worker["command"][:3] == ["python", "-m", "app.worker"]
    assert "--worker-id" in worker["command"]


def test_compose_defines_notification_worker_service():
    compose = yaml.safe_load((ROOT / "compose.yaml").read_text(encoding="utf-8"))
    services = compose["services"]

    assert "notification-worker" in services
    api = services["api"]
    notification_worker = services["notification-worker"]
    assert notification_worker["build"] == api["build"]
    assert notification_worker["environment"]["DATABASE_URL"] == api["environment"]["DATABASE_URL"]
    assert notification_worker["depends_on"]["postgres"]["condition"] == "service_healthy"
    assert notification_worker["command"][:3] == ["python", "-m", "app.notification_worker"]
    assert "--poll-interval" in notification_worker["command"]


def test_api_dockerfile_installs_postgres_extra_and_starts_api_by_default():
    dockerfile = (ROOT / "apps/api/Dockerfile").read_text(encoding="utf-8")

    assert "FROM python:3.12-slim" in dockerfile
    assert 'pip install --no-cache-dir -e ".[postgres]"' in dockerfile
    assert 'CMD ["sh", "-c", "uvicorn app.main:app' in dockerfile
    assert "--port ${PORT:-8080}" in dockerfile


def test_nginx_enables_hsts_for_public_https():
    nginx_config = (ROOT / "nginx.conf.template").read_text(encoding="utf-8")

    assert 'add_header Strict-Transport-Security "max-age=31536000" always;' in nginx_config


def test_nginx_limits_public_request_bodies():
    nginx_config = (ROOT / "nginx.conf.template").read_text(encoding="utf-8")

    assert "client_max_body_size 1m;" in nginx_config


def test_combined_image_delegates_security_headers_to_nginx():
    dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8")

    assert "ENV SECURITY_HEADERS_ENABLED=false" in dockerfile


def test_combined_image_uses_readiness_gated_entrypoint():
    dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8")
    entrypoint = (ROOT / "scripts/start-production.sh").read_text(encoding="utf-8")
    command_lines = [
        line for line in dockerfile.splitlines() if line.startswith("CMD ")
    ]
    assert len(command_lines) == 1
    command = json.loads(command_lines[0].removeprefix("CMD "))

    assert command == ["/usr/local/bin/start-production"]
    assert (
        "COPY scripts/start-production.sh /usr/local/bin/start-production"
        in dockerfile
    )
    assert "RUN chmod +x /usr/local/bin/start-production" in dockerfile

    commands = [line.strip() for line in entrypoint.splitlines() if line.strip()]
    assert "set -eu" in commands
    assert "python -m app.bootstrap" in commands
    assert (
        "python -m app.v1_lite_seed --json "
        "--skip-if-provider-unavailable"
    ) in entrypoint
    assert entrypoint.index("python -m app.bootstrap") < entrypoint.index(
        "python -m app.v1_lite_seed"
    )
    uvicorn_index = next(
        index for index, command in enumerate(commands) if command.startswith("uvicorn ")
    )
    health_probe_index = next(
        index for index, command in enumerate(commands) if "/api/health" in command
    )
    assert uvicorn_index < health_probe_index < commands.index("nginx")
    assert "api_pid=$!" in commands
    assert 'kill -0 "$api_pid"' in entrypoint
    assert "trap on_signal INT TERM" in commands
    assert "trap cleanup EXIT" in commands
    assert 'wait "$api_pid"' in entrypoint


def test_nginx_healthz_proxies_fastapi_health():
    nginx_config = (ROOT / "nginx.conf.template").read_text(encoding="utf-8")

    assert "location = /healthz {" in nginx_config
    healthz_block = nginx_config.split("location = /healthz {", 1)[1].split(
        "\n    }", 1
    )[0]
    assert "proxy_pass http://127.0.0.1:8000/api/health;" in healthz_block
    assert 'return 200 "ok";' not in healthz_block
