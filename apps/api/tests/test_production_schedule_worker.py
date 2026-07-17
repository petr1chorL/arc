from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]


def test_production_startup_supervises_api_and_execution_worker():
    script = (ROOT / "scripts/start-production.sh").read_text(encoding="utf-8")

    assert "python -m app.worker" in script
    assert "worker_pid=$!" in script
    assert 'kill -0 "$worker_pid"' in script
    assert 'wait "$worker_pid"' in script
