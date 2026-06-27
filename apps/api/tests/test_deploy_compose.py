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


def test_api_dockerfile_installs_postgres_extra_and_starts_api_by_default():
    dockerfile = (ROOT / "apps/api/Dockerfile").read_text(encoding="utf-8")

    assert "FROM python:3.12-slim" in dockerfile
    assert 'pip install --no-cache-dir -e ".[postgres]"' in dockerfile
    assert 'CMD ["uvicorn", "app.main:app"' in dockerfile
