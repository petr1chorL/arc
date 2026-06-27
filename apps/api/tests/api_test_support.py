from datetime import datetime, timezone

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.bootstrap import bootstrap_organization_admin
from app.database import create_database
from app.main import create_app
from app.models import Base, WorkspaceRecord
from app.security import SecurityService


ADMIN_EMAIL = "admin@example.com"
ADMIN_PASSWORD = "Admin Password 42!"
FIXED_NOW = datetime(2026, 6, 26, 9, 0, tzinfo=timezone.utc)


def login_client(
    client: TestClient,
    *,
    email: str = ADMIN_EMAIL,
    password: str = ADMIN_PASSWORD,
) -> None:
    response = client.post(
        "/api/auth/login",
        json={"email": email, "password": password},
    )
    assert response.status_code == 200


def login_admin(client: TestClient) -> None:
    login_client(client)


def csrf_headers(client: TestClient) -> dict[str, str]:
    return {"X-CSRF-Token": client.cookies["arc_one_csrf"]}


def workspace_url(workspace_id: str, suffix: str = "") -> str:
    return f"/api/workspaces/{workspace_id}{suffix}"


def create_authenticated_client(
    database_url: str,
    *,
    model_gateway=None,
    human_task_clock=None,
    tool_gateway=None,
    mcp_gateway=None,
) -> tuple[TestClient, str]:
    engine, session_factory = create_database(database_url)
    Base.metadata.create_all(engine)
    with session_factory() as session:
        bootstrap_organization_admin(
            session,
            SecurityService(),
            organization_name="ARC.ONE",
            organization_slug="arc-one",
            email=ADMIN_EMAIL,
            display_name="Organization Admin",
            password=ADMIN_PASSWORD,
            clock=lambda: FIXED_NOW,
        )
        workspace = session.scalar(select(WorkspaceRecord))
        assert workspace is not None
        workspace_id = workspace.id
    client = TestClient(
        create_app(
            database_url,
            model_gateway=model_gateway,
            human_task_clock=human_task_clock or (lambda: FIXED_NOW),
            auth_clock=lambda: FIXED_NOW,
            tool_gateway=tool_gateway,
            mcp_gateway=mcp_gateway,
        ),
    )
    login_admin(client)
    return client, workspace_id
