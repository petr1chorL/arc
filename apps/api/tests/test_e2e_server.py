from pathlib import Path

from app.e2e_server import build_e2e_environment


def test_build_e2e_environment_isolates_database_and_credentials(tmp_path: Path):
    environment, database_path = build_e2e_environment(
        root_dir=tmp_path,
        run_id="test-run",
        base_environment={"PATH": "test-path", "MODEL_API_KEY": "must-not-leak"},
    )

    expected_database = tmp_path / ".scratch" / "e2e" / "arc-one-e2e-test-run.db"
    assert database_path == expected_database
    assert environment["DATABASE_URL"] == f"sqlite:///{expected_database.as_posix()}"
    assert environment["ENVIRONMENT"] == "development"
    assert environment["ARC_ONE_ADMIN_EMAIL"] == "e2e-admin@arc-one.test"
    assert environment["ARC_ONE_ADMIN_PASSWORD"] == "ArcOne-E2E-Only-2026!"
    assert environment["MODEL_API_KEY"] == ""
    assert environment["MODEL_ALLOWED_HOSTS"] == ""
    assert environment["TOOL_HTTP_ALLOWED_HOSTS"] == ""
    assert environment["PATH"] == "test-path"
