from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.bootstrap import bootstrap_organization_admin
from app.database import create_database
from app.main import create_app
from app.models import (
    AgentRecord,
    AuditEventRecord,
    Base,
    OrganizationRecord,
    UserRecord,
    WorkflowRecord,
    WorkflowVersionRecord,
    WorkspaceMembershipRecord,
    WorkspaceRecord,
)
from app.security import SecurityService


ADMIN_EMAIL = "admin@example.com"
ADMIN_PASSWORD = "Admin Password 42!"
USER_PASSWORD = "Member Password 42!"


def login_client(
    client: TestClient,
    *,
    email: str,
    password: str = USER_PASSWORD,
) -> None:
    response = client.post(
        "/api/auth/login",
        json={"email": email, "password": password},
    )
    assert response.status_code == 200


def login_admin(client: TestClient) -> None:
    login_client(client, email=ADMIN_EMAIL, password=ADMIN_PASSWORD)


def csrf_headers(client: TestClient) -> dict[str, str]:
    return {"X-CSRF-Token": client.cookies["arc_one_csrf"]}


def workspace_url(workspace_id: str, suffix: str = "") -> str:
    return f"/api/workspaces/{workspace_id}{suffix}"


def create_user(
    session,
    organization_id: str,
    security: SecurityService,
    *,
    email: str,
    display_name: str,
    is_organization_admin: bool = False,
) -> UserRecord:
    now = datetime(2026, 6, 26, 9, 0, tzinfo=timezone.utc)
    user = UserRecord(
        organization_id=organization_id,
        email=email,
        normalized_email=email.casefold(),
        display_name=display_name,
        password_hash=security.hash_password(USER_PASSWORD),
        status="active",
        is_organization_admin=is_organization_admin,
        password_changed_at=now,
        created_at=now,
        updated_at=now,
    )
    session.add(user)
    session.flush()
    return user


@pytest.fixture
def workspace_context(tmp_path):
    database_url = f"sqlite:///{tmp_path / 'workspace-access.db'}"
    engine, session_factory = create_database(database_url)
    Base.metadata.create_all(engine)
    security = SecurityService()
    now = datetime(2026, 6, 26, 9, 0, tzinfo=timezone.utc)

    with session_factory() as session:
        admin = bootstrap_organization_admin(
            session,
            security,
            organization_name="ARC.ONE",
            organization_slug="arc-one",
            email=ADMIN_EMAIL,
            display_name="Organization Admin",
            password=ADMIN_PASSWORD,
            clock=lambda: now,
        )
        organization = session.scalar(select(OrganizationRecord))
        workspace_a = session.scalar(select(WorkspaceRecord))
        assert organization is not None
        assert workspace_a is not None

        workspace_b = WorkspaceRecord(
            organization_id=organization.id,
            name="Workspace B",
            slug="workspace-b",
            status="active",
            created_by=admin.id,
            created_at=now,
            updated_at=now,
        )
        inactive_workspace = WorkspaceRecord(
            organization_id=organization.id,
            name="Inactive Workspace",
            slug="inactive-workspace",
            status="disabled",
            created_by=admin.id,
            created_at=now,
            updated_at=now,
        )
        session.add_all([workspace_b, inactive_workspace])
        session.flush()

        viewer = create_user(
            session,
            organization.id,
            security,
            email="viewer@example.com",
            display_name="Viewer",
        )
        operator = create_user(
            session,
            organization.id,
            security,
            email="operator@example.com",
            display_name="Operator",
        )
        builder = create_user(
            session,
            organization.id,
            security,
            email="builder@example.com",
            display_name="Builder",
        )
        workspace_admin = create_user(
            session,
            organization.id,
            security,
            email="workspace-admin@example.com",
            display_name="Workspace Admin",
        )
        outsider = create_user(
            session,
            organization.id,
            security,
            email="outsider@example.com",
            display_name="Outsider",
        )

        memberships = [
            WorkspaceMembershipRecord(
                workspace_id=workspace_a.id,
                user_id=viewer.id,
                role="viewer",
                status="active",
                invited_by=admin.id,
                activated_at=now,
                created_at=now,
                updated_at=now,
            ),
            WorkspaceMembershipRecord(
                workspace_id=workspace_a.id,
                user_id=operator.id,
                role="operator",
                status="active",
                invited_by=admin.id,
                activated_at=now,
                created_at=now,
                updated_at=now,
            ),
            WorkspaceMembershipRecord(
                workspace_id=workspace_a.id,
                user_id=builder.id,
                role="builder",
                status="active",
                invited_by=admin.id,
                activated_at=now,
                created_at=now,
                updated_at=now,
            ),
            WorkspaceMembershipRecord(
                workspace_id=workspace_a.id,
                user_id=workspace_admin.id,
                role="workspace_admin",
                status="active",
                invited_by=admin.id,
                activated_at=now,
                created_at=now,
                updated_at=now,
            ),
            WorkspaceMembershipRecord(
                workspace_id=workspace_b.id,
                user_id=outsider.id,
                role="builder",
                status="active",
                invited_by=admin.id,
                activated_at=now,
                created_at=now,
                updated_at=now,
            ),
        ]
        session.add_all(memberships)

        agent_a = AgentRecord(
            workspace_id=workspace_a.id,
            name="Agent A",
            role="Draft responses",
            owner="Ops",
            model="fake-model",
            created_at=now,
            updated_at=now,
        )
        agent_b = AgentRecord(
            workspace_id=workspace_b.id,
            name="Agent B",
            role="Private workspace asset",
            owner="Ops",
            model="fake-model",
            created_at=now,
            updated_at=now,
        )
        workflow = WorkflowRecord(
            workspace_id=workspace_a.id,
            name="Published Workflow",
            status="已发布",
            version="v1.0.0",
            nodes=[
                {
                    "id": "start",
                    "type": "trigger",
                    "position": {"x": 0, "y": 0},
                    "data": {"label": "开始"},
                },
                {
                    "id": "end",
                    "type": "end",
                    "position": {"x": 200, "y": 0},
                    "data": {"label": "结束"},
                },
            ],
            edges=[{"id": "start-end", "source": "start", "target": "end"}],
            created_at=now,
            updated_at=now,
        )
        session.add_all([agent_a, agent_b, workflow])
        session.flush()
        session.add(
            WorkflowVersionRecord(
                workspace_id=workspace_a.id,
                workflow_id=workflow.id,
                version="v1.0.0",
                snapshot={
                    "id": workflow.id,
                    "name": workflow.name,
                    "status": workflow.status,
                    "version": workflow.version,
                    "nodes": workflow.nodes,
                    "edges": workflow.edges,
                    "createdAt": now.isoformat(),
                    "updatedAt": now.isoformat(),
                },
                created_at=now,
            ),
        )
        session.commit()

    client = TestClient(create_app(database_url, auth_clock=lambda: now))
    return {
        "client": client,
        "session_factory": session_factory,
        "workspaces": {
            "a": workspace_a.id,
            "b": workspace_b.id,
            "inactive": inactive_workspace.id,
        },
        "agents": {"a": agent_a.id, "b": agent_b.id},
        "workflow_id": workflow.id,
        "users": {
            "admin": ADMIN_EMAIL,
            "viewer": "viewer@example.com",
            "operator": "operator@example.com",
            "builder": "builder@example.com",
            "workspace_admin": "workspace-admin@example.com",
            "outsider": "outsider@example.com",
        },
    }


@pytest.mark.parametrize(
    ("user_key", "method", "suffix", "body", "expected_status"),
    [
        ("viewer", "get", "/agents", None, 200),
        (
            "viewer",
            "post",
            "/agents",
            {
                "name": "Blocked Agent",
                "role": "Should not create",
                "owner": "Ops",
                "model": "fake-model",
            },
            403,
        ),
        (
            "operator",
            "post",
            None,
            {"input": "Run the workflow"},
            201,
        ),
        (
            "operator",
            "patch",
            None,
            {"name": "Operator Cannot Edit"},
            403,
        ),
        (
            "builder",
            "patch",
            None,
            {"name": "Builder Updated Agent"},
            200,
        ),
        ("builder", "post", None, None, 201),
        ("workspace_admin", "post", None, None, 200),
    ],
)
def test_workspace_capability_matrix_and_isolation(
    workspace_context,
    user_key: str,
    method: str,
    suffix: str | None,
    body: dict | None,
    expected_status: int,
):
    client: TestClient = workspace_context["client"]
    workspace_id = workspace_context["workspaces"]["a"]
    workflow_id = workspace_context["workflow_id"]
    agent_id = workspace_context["agents"]["a"]

    login_client(client, email=workspace_context["users"][user_key])
    headers = csrf_headers(client) if method in {"post", "patch"} else {}

    if suffix is not None:
        url = workspace_url(workspace_id, suffix)
    elif method == "post" and body == {"input": "Run the workflow"}:
        url = workspace_url(workspace_id, f"/workflows/{workflow_id}/runs")
    elif method == "patch":
        url = workspace_url(workspace_id, f"/agents/{agent_id}")
    elif expected_status == 201:
        url = workspace_url(workspace_id, f"/agents/{agent_id}/publish")
    else:
        url = workspace_url(workspace_id, f"/agents/{agent_id}/deactivate")

    request_kwargs = {"headers": headers}
    if body is not None:
        request_kwargs["json"] = body
    response = getattr(client, method)(url, **request_kwargs)

    assert response.status_code == expected_status

    isolated = client.get(
        workspace_url(
            workspace_context["workspaces"]["a"],
            f"/agents/{workspace_context['agents']['b']}",
        ),
    )
    assert isolated.status_code == 404


def test_get_workspaces_returns_only_accessible_active_workspaces_and_org_admin_gets_org_list(
    workspace_context,
):
    client: TestClient = workspace_context["client"]

    login_client(client, email=workspace_context["users"]["builder"])
    member_response = client.get("/api/workspaces")
    assert member_response.status_code == 200
    assert [workspace["id"] for workspace in member_response.json()] == [
        workspace_context["workspaces"]["a"],
    ]

    client.cookies.clear()
    login_admin(client)
    admin_response = client.get("/api/workspaces")
    assert admin_response.status_code == 200
    assert {workspace["id"] for workspace in admin_response.json()} == {
        workspace_context["workspaces"]["a"],
        workspace_context["workspaces"]["b"],
    }


def test_post_workspaces_requires_org_admin_creates_workspace_and_membership_and_audit(
    workspace_context,
):
    client: TestClient = workspace_context["client"]
    session_factory = workspace_context["session_factory"]

    login_client(client, email=workspace_context["users"]["builder"])
    denied = client.post(
        "/api/workspaces",
        json={"name": "Builder Workspace", "slug": "builder-workspace"},
        headers=csrf_headers(client),
    )
    assert denied.status_code == 403

    with session_factory() as session:
        denied_event = session.scalars(
            select(AuditEventRecord).order_by(AuditEventRecord.created_at.desc()),
        ).first()
        assert denied_event is not None
        assert denied_event.outcome == "denied"
        assert denied_event.workspace_id is None

    client.cookies.clear()
    login_admin(client)
    created = client.post(
        "/api/workspaces",
        json={"name": "New Workspace", "slug": "new-workspace"},
        headers=csrf_headers(client),
    )
    assert created.status_code == 201

    workspace_id = created.json()["id"]
    with session_factory() as session:
        membership = session.scalar(
            select(WorkspaceMembershipRecord).where(
                WorkspaceMembershipRecord.workspace_id == workspace_id,
                WorkspaceMembershipRecord.role == "workspace_admin",
            ),
        )
        success_event = session.scalars(
            select(AuditEventRecord).order_by(AuditEventRecord.created_at.desc()),
        ).first()
        assert membership is not None
        assert membership.status == "active"
        assert success_event is not None
        assert success_event.outcome == "success"
        assert success_event.workspace_id == workspace_id


def test_legacy_business_paths_are_not_anonymous_compatible_entrypoints(workspace_context):
    client: TestClient = workspace_context["client"]
    paths = [
        "/api/agents",
        "/api/workflows",
        "/api/runs",
        "/api/human-tasks",
        "/api/reviewers",
        "/api/feedback-candidates",
    ]

    for path in paths:
        response = client.get(path)
        assert response.status_code in {401, 404}
        assert response.status_code != 200


def test_successful_asset_mutations_write_success_audit_events(workspace_context):
    client: TestClient = workspace_context["client"]
    session_factory = workspace_context["session_factory"]
    workspace_id = workspace_context["workspaces"]["a"]
    agent_id = workspace_context["agents"]["a"]

    login_client(client, email=workspace_context["users"]["builder"])
    updated = client.patch(
        workspace_url(workspace_id, f"/agents/{agent_id}"),
        json={"name": "Audited Agent Name"},
        headers=csrf_headers(client),
    )
    assert updated.status_code == 200

    published = client.post(
        workspace_url(workspace_id, f"/agents/{agent_id}/publish"),
        headers=csrf_headers(client),
    )
    assert published.status_code == 201

    with session_factory() as session:
        events = list(
            session.scalars(
                select(AuditEventRecord)
                .where(AuditEventRecord.workspace_id == workspace_id)
                .order_by(AuditEventRecord.created_at.desc()),
            ),
        )
        assert any(event.outcome == "success" for event in events)
