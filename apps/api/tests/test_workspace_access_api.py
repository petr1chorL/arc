from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.bootstrap import bootstrap_organization_admin
from app.database import create_database
from app.main import create_app
from app.models import (
    AgentRecord,
    AuditEventRecord,
    Base,
    FeedbackCandidateRecord,
    HumanTaskRecord,
    OrganizationRecord,
    ReviewGroupRecord,
    ReviewerRecord,
    UserRecord,
    WorkflowRunRecord,
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
        headers={**csrf_headers(client), "X-Request-ID": "req-denied-workspace"},
    )
    assert denied.status_code == 403

    with session_factory() as session:
        denied_event = session.scalars(
            select(AuditEventRecord).order_by(AuditEventRecord.created_at.desc()),
        ).first()
        assert denied_event is not None
        assert denied_event.outcome == "denied"
        assert denied_event.workspace_id is None
        assert denied_event.request_id == "req-denied-workspace"

    client.cookies.clear()
    login_admin(client)
    created = client.post(
        "/api/workspaces",
        json={"name": "New Workspace", "slug": "new-workspace"},
        headers={**csrf_headers(client), "X-Request-ID": "req-success-workspace"},
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
        assert success_event.request_id == "req-success-workspace"


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


def test_workspace_admin_can_list_filtered_workspace_audit_events(workspace_context):
    client: TestClient = workspace_context["client"]
    session_factory = workspace_context["session_factory"]
    workspace_a = workspace_context["workspaces"]["a"]
    workspace_b = workspace_context["workspaces"]["b"]
    created_at = datetime(2026, 6, 26, 10, 0, tzinfo=timezone.utc)

    with session_factory() as session:
        session.add_all([
            AuditEventRecord(
                workspace_id=workspace_a,
                organization_id=None,
                actor_user_id="actor-builder",
                action="tool_skill_asset.update",
                target_type="tool_skill_asset",
                target_id="asset-a",
                outcome="success",
                request_id="req-asset-a",
                event_metadata={"assetName": "价格查询 Tool", "changedFields": ["name"]},
                reason="rename asset",
                trace_id="trace-asset-a",
                span_id="span-asset-a",
                created_at=created_at,
            ),
            AuditEventRecord(
                workspace_id=workspace_a,
                organization_id=None,
                actor_user_id="actor-builder",
                action="agent.publish",
                target_type="agent",
                target_id="agent-a",
                outcome="success",
                request_id="req-agent-a",
                event_metadata={"agentName": "竞品研究 Agent"},
                created_at=created_at.replace(hour=9),
            ),
            AuditEventRecord(
                workspace_id=workspace_b,
                organization_id=None,
                actor_user_id="actor-outsider",
                action="tool_skill_asset.update",
                target_type="tool_skill_asset",
                target_id="asset-b",
                outcome="success",
                request_id="req-asset-b",
                event_metadata={"assetName": "Other Workspace Tool"},
                created_at=created_at.replace(hour=11),
            ),
        ])
        session.commit()

    login_client(client, email=workspace_context["users"]["workspace_admin"])
    response = client.get(
        workspace_url(
            workspace_a,
            "/audit-events?action=tool_skill_asset.update&targetType=tool_skill_asset&outcome=success&limit=10",
        ),
    )

    assert response.status_code == 200
    events = response.json()
    assert len(events) == 1
    assert events[0]["action"] == "tool_skill_asset.update"
    assert events[0]["targetType"] == "tool_skill_asset"
    assert events[0]["targetId"] == "asset-a"
    assert events[0]["outcome"] == "success"
    assert events[0]["actorId"] == "actor-builder"
    assert events[0]["requestId"] == "req-asset-a"
    assert events[0]["traceId"] == "trace-asset-a"
    assert events[0]["metadata"]["assetName"] == "价格查询 Tool"
    assert "createdAt" in events[0]


def test_viewer_cannot_list_workspace_audit_events(workspace_context):
    client: TestClient = workspace_context["client"]
    workspace_id = workspace_context["workspaces"]["a"]

    login_client(client, email=workspace_context["users"]["viewer"])
    response = client.get(workspace_url(workspace_id, "/audit-events"))

    assert response.status_code == 403


def test_workspace_admin_can_read_permission_matrix(workspace_context):
    client: TestClient = workspace_context["client"]
    workspace_id = workspace_context["workspaces"]["a"]

    login_client(client, email=workspace_context["users"]["workspace_admin"])
    response = client.get(workspace_url(workspace_id, "/permissions/matrix"))

    assert response.status_code == 200
    matrix = response.json()
    assert matrix["roles"] == ["viewer", "operator", "builder", "workspace_admin"]
    capability_keys = {capability["key"] for capability in matrix["capabilities"]}
    assert {"asset.read", "run.execute", "agent.write", "audit.read"}.issubset(capability_keys)
    role_permissions = {
        role["role"]: role["capabilities"]
        for role in matrix["matrix"]
    }
    assert role_permissions["viewer"]["asset.read"] is True
    assert role_permissions["viewer"]["run.execute"] is False
    assert role_permissions["operator"]["run.execute"] is True
    assert role_permissions["builder"]["agent.write"] is True
    assert role_permissions["builder"]["audit.read"] is False
    assert role_permissions["workspace_admin"]["audit.read"] is True
    assert "Reviewer" in matrix["reviewerQualificationNote"]


def test_viewer_cannot_read_permission_matrix(workspace_context):
    client: TestClient = workspace_context["client"]
    workspace_id = workspace_context["workspaces"]["a"]

    login_client(client, email=workspace_context["users"]["viewer"])
    response = client.get(workspace_url(workspace_id, "/permissions/matrix"))

    assert response.status_code == 403


def test_non_member_existing_workspace_returns_404_and_writes_denied_audit(workspace_context):
    client: TestClient = workspace_context["client"]
    session_factory = workspace_context["session_factory"]

    login_client(client, email=workspace_context["users"]["builder"])
    response = client.get(
        workspace_url(workspace_context["workspaces"]["b"], "/agents"),
        headers={"X-Request-ID": "req-non-member-workspace"},
    )

    assert response.status_code == 404

    with session_factory() as session:
        denied_event = session.scalars(
            select(AuditEventRecord)
            .where(AuditEventRecord.action == "workspace.access_denied")
            .order_by(AuditEventRecord.created_at.desc()),
        ).first()
        assert denied_event is not None
        assert denied_event.outcome == "denied"
        assert denied_event.workspace_id == workspace_context["workspaces"]["b"]
        assert denied_event.target_id == workspace_context["workspaces"]["b"]
        assert denied_event.request_id == "req-non-member-workspace"


def test_get_reviewers_does_not_write_directory_records(workspace_context):
    client: TestClient = workspace_context["client"]
    session_factory = workspace_context["session_factory"]
    workspace_id = workspace_context["workspaces"]["a"]

    with session_factory() as session:
        before_reviewers = session.scalar(
            select(func.count()).select_from(ReviewerRecord).where(
                ReviewerRecord.workspace_id == workspace_id,
            ),
        )
        before_groups = session.scalar(
            select(func.count()).select_from(ReviewGroupRecord).where(
                ReviewGroupRecord.workspace_id == workspace_id,
            ),
        )

    login_client(client, email=workspace_context["users"]["viewer"])
    response = client.get(workspace_url(workspace_id, "/reviewers"))
    assert response.status_code == 200

    with session_factory() as session:
        after_reviewers = session.scalar(
            select(func.count()).select_from(ReviewerRecord).where(
                ReviewerRecord.workspace_id == workspace_id,
            ),
        )
        after_groups = session.scalar(
            select(func.count()).select_from(ReviewGroupRecord).where(
                ReviewGroupRecord.workspace_id == workspace_id,
            ),
        )

    assert after_reviewers == before_reviewers
    assert after_groups == before_groups


def test_cross_workspace_run_human_task_and_feedback_candidate_queries_return_404(workspace_context):
    client: TestClient = workspace_context["client"]
    session_factory = workspace_context["session_factory"]
    workspace_a = workspace_context["workspaces"]["a"]
    workspace_b = workspace_context["workspaces"]["b"]

    with session_factory() as session:
        now = datetime(2026, 6, 26, 9, 30, tzinfo=timezone.utc)
        run = WorkflowRunRecord(
            workspace_id=workspace_b,
            kind="workflow",
            name="Private Run",
            workflow_id=workspace_context["workflow_id"],
            workflow_version="v1.0.0",
            input_text="secret",
        )
        session.add(run)
        session.flush()
        task = HumanTaskRecord(
            workspace_id=workspace_b,
            workflow_run_id=run.id,
            node_run_id="node-run-b",
            human_node_id="human-1",
            source_node_id="agent-1",
            artifact_version_id="artifact-version-b",
            title="Private Task",
            status="pending",
            assignment_type="group_claim",
            participant_snapshot=[],
            review_policy="any_one",
            required_approvals=1,
            due_at=now,
            escalation_at=now,
            created_at=now,
            updated_at=now,
        )
        session.add(task)
        session.flush()
        candidate = FeedbackCandidateRecord(
            workspace_id=workspace_b,
            human_task_id=task.id,
            decision_id="decision-b",
            original_version_id="artifact-version-1",
            modified_version_id="artifact-version-2",
            diff_id="diff-b",
            reason="private candidate",
            tags=[],
            workflow_run_id=run.id,
            workflow_id=workspace_context["workflow_id"],
            agent_id=workspace_context["agents"]["b"],
            source_node_id="agent-1",
            created_by="reviewer-b",
        )
        session.add(candidate)
        session.commit()
        run_id = run.id
        task_id = task.id
        candidate_id = candidate.id

    login_client(client, email=workspace_context["users"]["builder"])

    run_response = client.get(workspace_url(workspace_a, f"/runs/{run_id}"))
    task_response = client.get(workspace_url(workspace_a, f"/human-tasks/{task_id}"))
    candidate_response = client.get(
        workspace_url(workspace_a, f"/feedback-candidates/{candidate_id}"),
    )

    assert run_response.status_code == 404
    assert task_response.status_code == 404
    assert candidate_response.status_code == 404
