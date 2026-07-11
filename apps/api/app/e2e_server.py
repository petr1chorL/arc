from __future__ import annotations

import os
from collections.abc import Mapping
from pathlib import Path

import uvicorn
from fastapi import BackgroundTasks

from app.bootstrap import bootstrap_organization_admin
from app.config import Settings
from app.database import create_database
from app.migrations import DEFAULT_ORGANIZATION_SLUG, ensure_current_schema
from app.models import Base
from app.security import SecurityService


TEST_ADMIN_EMAIL = "e2e-admin@arc-one.test"
TEST_ADMIN_PASSWORD = "ArcOne-E2E-Only-2026!"


def build_e2e_environment(
    *,
    root_dir: Path,
    run_id: str,
    base_environment: Mapping[str, str] | None = None,
) -> tuple[dict[str, str], Path]:
    database_path = (
        root_dir / ".scratch" / "e2e" / f"arc-one-e2e-{run_id}.db"
    ).resolve()
    environment = dict(base_environment or os.environ)
    environment.update(
        {
            "ENVIRONMENT": "development",
            "DATABASE_URL": f"sqlite:///{database_path.as_posix()}",
            "ARC_ONE_ADMIN_EMAIL": TEST_ADMIN_EMAIL,
            "ARC_ONE_ADMIN_PASSWORD": TEST_ADMIN_PASSWORD,
            "ARC_ONE_ADMIN_DISPLAY_NAME": "E2E 管理员",
            "ARC_ONE_ORGANIZATION_NAME": "ARC.ONE E2E",
            "ALLOWED_ORIGINS": "http://127.0.0.1:48173",
            "ALLOWED_HOSTS": "127.0.0.1,localhost,testserver",
            "COOKIE_SECURE": "false",
            "HSTS_ENABLED": "false",
            "MODEL_API_KEY": "",
            "MODEL_ALLOWED_HOSTS": "",
            "TOOL_HTTP_ALLOWED_HOSTS": "",
        }
    )
    return environment, database_path


def _database_files(database_path: Path) -> tuple[Path, ...]:
    return (
        database_path,
        Path(f"{database_path}-shm"),
        Path(f"{database_path}-wal"),
    )


def _cleanup_database(database_path: Path) -> None:
    for path in _database_files(database_path):
        path.unlink(missing_ok=True)


def main() -> None:
    root_dir = Path(__file__).resolve().parents[3]
    run_id = os.environ.get("ARC_ONE_E2E_RUN_ID", str(os.getpid()))
    environment, database_path = build_e2e_environment(
        root_dir=root_dir,
        run_id=run_id,
    )
    database_path.parent.mkdir(parents=True, exist_ok=True)
    _cleanup_database(database_path)
    os.environ.update(environment)

    settings = Settings()
    engine, session_factory = create_database(settings.database_url)
    application = None
    try:
        Base.metadata.create_all(engine)
        ensure_current_schema(engine)
        with session_factory() as session:
            bootstrap_organization_admin(
                session,
                SecurityService(),
                organization_name=environment["ARC_ONE_ORGANIZATION_NAME"],
                organization_slug=DEFAULT_ORGANIZATION_SLUG,
                email=TEST_ADMIN_EMAIL,
                display_name=environment["ARC_ONE_ADMIN_DISPLAY_NAME"],
                password=TEST_ADMIN_PASSWORD,
            )

        from app import main as application

        config = uvicorn.Config(
            application.app,
            host="127.0.0.1",
            port=int(os.environ.get("ARC_ONE_E2E_API_PORT", "48100")),
        )
        server = uvicorn.Server(config)

        def request_shutdown() -> None:
            server.should_exit = True

        async def shutdown(background_tasks: BackgroundTasks) -> dict[str, str]:
            background_tasks.add_task(request_shutdown)
            return {"status": "shutting_down"}

        application.app.add_api_route(
            "/__e2e__/shutdown",
            shutdown,
            methods=["POST"],
            include_in_schema=False,
        )
        server.run()
    finally:
        if application is not None:
            application.engine.dispose()
        engine.dispose()
        _cleanup_database(database_path)


if __name__ == "__main__":
    main()
