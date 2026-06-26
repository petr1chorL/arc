from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

from fastapi.testclient import TestClient
from sqlalchemy import select

from api_test_support import ADMIN_PASSWORD, csrf_headers
from app.bootstrap import bootstrap_organization_admin
from app.database import create_database
from app.main import create_app
from app.models import (
    AuditEventRecord,
    Base,
    ReviewerRecord,
    SessionRecord,
    UserRecord,
    WorkspaceMembershipRecord,
    WorkspaceRecord,
)
from app.security import SecurityService


WORKSPACE_ADMIN_EMAIL = "workspace-admin@example.com"
MEMBER_EMAIL = "builder@example.com"
FIXED_NOW = datetime(2026, 6, 26, 9, 0, tzinfo=timezone.utc)


class MutableClock:
    def __init__(self, current: datetime):
        self.current = current

    def __call__(self) -> datetime:
        return self.current

    def advance(self, **kwargs: int) -> None:
        self.current += timedelta(**kwargs)


def login(client: TestClient, email: str, password: str = ADMIN_PASSWORD) -> None:
    response = client.post(
        "/api/auth/login",
        json={"email": email, "password": password},
    )
    assert response.status_code == 200


def create_membership_context(tmp_path):
    database_url = f"sqlite:///{tmp_path / 'membership.db'}"
    engine, session_factory = create_database(database_url)
    Base.metadata.create_all(engine)
    security = SecurityService()
    clock = MutableClock(FIXED_NOW)

    with session_factory() as session:
        admin = bootstrap_organization_admin(
            session,
            security,
            organization_name="ARC.ONE",
            organization_slug="arc-one",
            email="admin@example.com",
            display_name="Organization Admin",
            password=ADMIN_PASSWORD,
            clock=clock,
        )
        workspace = session.scalar(select(WorkspaceRecord))
        assert workspace is not None

        workspace_admin = UserRecord(
            organization_id=admin.organization_id,
            email=WORKSPACE_ADMIN_EMAIL,
            normalized_email=WORKSPACE_ADMIN_EMAIL,
            display_name="Workspace Admin",
            password_hash=security.hash_password(ADMIN_PASSWORD),
            status="active",
            password_changed_at=clock.current,
            created_at=clock.current,
            updated_at=clock.current,
        )
        member = UserRecord(
            organization_id=admin.organization_id,
            email=MEMBER_EMAIL,
            normalized_email=MEMBER_EMAIL,
            display_name="Builder",
            password_hash=security.hash_password(ADMIN_PASSWORD),
            status="active",
            password_changed_at=clock.current,
            created_at=clock.current,
            updated_at=clock.current,
        )
        session.add_all([workspace_admin, member])
        session.flush()
        session.add_all(
            [
                WorkspaceMembershipRecord(
                    workspace_id=workspace.id,
                    user_id=workspace_admin.id,
                    role="workspace_admin",
                    status="active",
                    invited_by=admin.id,
                    activated_at=clock.current,
                    created_at=clock.current,
                    updated_at=clock.current,
                ),
                WorkspaceMembershipRecord(
                    workspace_id=workspace.id,
                    user_id=member.id,
                    role="builder",
                    status="active",
                    invited_by=admin.id,
                    activated_at=clock.current,
                    created_at=clock.current,
                    updated_at=clock.current,
                ),
            ],
        )
        session.add(
            ReviewerRecord(
                workspace_id=workspace.id,
                user_id=member.id,
                name="Builder Reviewer",
                role="内容审核人",
                is_expert=True,
                is_active=True,
                created_at=clock.current,
            ),
        )
        session.commit()
        admin_id = admin.id
        workspace_admin_id = workspace_admin.id
        member_id = member.id

    client = TestClient(create_app(database_url, auth_clock=clock))
    return {
        "client": client,
        "clock": clock,
        "session_factory": session_factory,
        "workspace_id": workspace.id,
        "admin_id": admin_id,
        "workspace_admin_id": workspace_admin_id,
        "member_id": member_id,
    }


def invite_member(client: TestClient, workspace_id: str, email: str, role: str = "viewer") -> dict:
    response = client.post(
        f"/api/workspaces/{workspace_id}/invitations",
        json={"email": email, "role": role},
        headers=csrf_headers(client),
    )
    assert response.status_code == 201
    return response.json()


def extract_token(activation_url: str) -> str:
    return urlparse(activation_url).path.rsplit("/", 1)[-1]


def test_invitation_create_list_preview_and_activate_flow(tmp_path):
    context = create_membership_context(tmp_path)
    client: TestClient = context["client"]
    session_factory = context["session_factory"]
    workspace_id = context["workspace_id"]

    login(client, WORKSPACE_ADMIN_EMAIL)
    created = invite_member(client, workspace_id, " New.User@Example.com ", "operator")

    assert created["email"] == "new.user@example.com"
    assert created["role"] == "operator"
    assert created["activationUrl"].startswith("http://testserver/activate/")

    list_response = client.get(f"/api/workspaces/{workspace_id}/members")
    assert list_response.status_code == 200
    listed = list_response.json()
    invited = next(item for item in listed if item["email"] == "new.user@example.com")
    assert invited["role"] == "operator"
    assert invited["userStatus"] == "pending_email"
    assert invited["membershipStatus"] == "invited"
    assert invited["reviewer"] is None
    assert "activationUrl" not in invited
    assert "token" not in str(invited).lower()

    existing = next(item for item in listed if item["email"] == MEMBER_EMAIL)
    assert existing["reviewer"] == {
        "isActive": True,
        "isExpert": True,
        "role": "内容审核人",
    }

    token = extract_token(created["activationUrl"])
    preview = client.get(f"/api/invitations/{token}")
    assert preview.status_code == 200
    assert preview.json() == {
        "email": "new.user@example.com",
        "workspaceName": "AI 能力中心",
        "role": "operator",
        "expiresAt": created["expiresAt"],
    }

    activated = client.post(
        f"/api/invitations/{token}/activate",
        json={
            "displayName": "新成员",
            "password": "Activated Password 42!",
        },
    )
    assert activated.status_code == 204

    repeated = client.post(
        f"/api/invitations/{token}/activate",
        json={
            "displayName": "新成员",
            "password": "Activated Password 42!",
        },
    )
    assert repeated.status_code == 409

    login(client, "new.user@example.com", "Activated Password 42!")

    with session_factory() as session:
        events = list(
            session.scalars(
                select(AuditEventRecord).order_by(AuditEventRecord.created_at.asc()),
            ),
        )
        create_event = next(
            event for event in events if event.action == "member.invitation.create"
        )
        assert create_event.target_id == created["invitationId"]
        assert create_event.workspace_id == workspace_id
        serialized = " ".join(str(event.event_metadata or {}) for event in events).lower()
        assert "activated password 42!" not in serialized
        assert token not in serialized


def test_resend_revokes_old_token_and_revoke_blocks_activation(tmp_path):
    context = create_membership_context(tmp_path)
    client: TestClient = context["client"]
    workspace_id = context["workspace_id"]

    login(client, WORKSPACE_ADMIN_EMAIL)
    created = invite_member(client, workspace_id, "resend@example.com", "viewer")
    invitation_id = created["invitationId"]
    old_token = extract_token(created["activationUrl"])

    resent = client.post(
        f"/api/workspaces/{workspace_id}/invitations/{invitation_id}/resend",
        headers=csrf_headers(client),
    )
    assert resent.status_code == 200
    new_token = extract_token(resent.json()["activationUrl"])
    assert new_token != old_token

    old_preview = client.get(f"/api/invitations/{old_token}")
    old_activate = client.post(
        f"/api/invitations/{old_token}/activate",
        json={"displayName": "过期成员", "password": "Activated Password 42!"},
    )
    assert old_preview.status_code == 409
    assert old_activate.status_code == 409

    revoked = client.post(
        f"/api/workspaces/{workspace_id}/invitations/{invitation_id}/revoke",
        headers=csrf_headers(client),
    )
    assert revoked.status_code == 204

    new_preview = client.get(f"/api/invitations/{new_token}")
    new_activate = client.post(
        f"/api/invitations/{new_token}/activate",
        json={"displayName": "已撤销成员", "password": "Activated Password 42!"},
    )
    assert new_preview.status_code == 409
    assert new_activate.status_code == 409


def test_expired_invitation_preview_and_activation_conflict(tmp_path):
    context = create_membership_context(tmp_path)
    client: TestClient = context["client"]
    clock: MutableClock = context["clock"]
    workspace_id = context["workspace_id"]

    login(client, WORKSPACE_ADMIN_EMAIL)
    created = invite_member(client, workspace_id, "expired@example.com", "viewer")
    token = extract_token(created["activationUrl"])
    clock.advance(hours=73)

    preview = client.get(f"/api/invitations/{token}")
    activate = client.post(
        f"/api/invitations/{token}/activate",
        json={"displayName": "过期成员", "password": "Activated Password 42!"},
    )
    assert preview.status_code == 409
    assert activate.status_code == 409


def test_invitation_origin_rate_limit_and_copy_audit(tmp_path):
    context = create_membership_context(tmp_path)
    client: TestClient = context["client"]
    clock: MutableClock = context["clock"]
    session_factory = context["session_factory"]
    workspace_id = context["workspace_id"]

    login(client, WORKSPACE_ADMIN_EMAIL)
    created = invite_member(client, workspace_id, "limited@example.com", "viewer")
    token = extract_token(created["activationUrl"])

    cross_origin = client.get(
        f"/api/invitations/{token}",
        headers={"Origin": "http://evil.test"},
    )
    assert cross_origin.status_code == 403

    for index in range(20):
        unknown = client.get(f"/api/invitations/unknown-token-{index}")
        assert unknown.status_code == 409
    limited_unknown = client.get("/api/invitations/another-unknown-token")
    assert limited_unknown.status_code == 429

    clock.advance(hours=2)
    for _ in range(20):
        assert client.get(f"/api/invitations/{token}").status_code == 200
    limited_preview = client.get(f"/api/invitations/{token}")
    assert limited_preview.status_code == 429

    copied = client.post(
        f"/api/workspaces/{workspace_id}/invitations/{created['invitationId']}/copy",
        headers=csrf_headers(client),
    )
    assert copied.status_code == 204

    with session_factory() as session:
        event = session.scalar(
            select(AuditEventRecord).where(
                AuditEventRecord.action == "member.invitation.copy_link",
            ),
        )
        assert event is not None
        assert event.workspace_id == workspace_id
        assert event.organization_id is not None
        serialized = str(event.event_metadata or {}).lower()
        assert token not in serialized


def test_member_role_change_and_enable_disable_guards(tmp_path):
    context = create_membership_context(tmp_path)
    client: TestClient = context["client"]
    workspace_id = context["workspace_id"]
    workspace_admin_id = context["workspace_admin_id"]
    member_id = context["member_id"]

    login(client, WORKSPACE_ADMIN_EMAIL)

    patched = client.patch(
        f"/api/workspaces/{workspace_id}/members/{member_id}",
        json={"role": "operator"},
        headers=csrf_headers(client),
    )
    assert patched.status_code == 200
    assert patched.json()["role"] == "operator"

    disabled = client.post(
        f"/api/workspaces/{workspace_id}/members/{member_id}/disable",
        headers=csrf_headers(client),
    )
    assert disabled.status_code == 200
    assert disabled.json()["membershipStatus"] == "disabled"
    assert disabled.json()["userStatus"] == "active"

    enabled = client.post(
        f"/api/workspaces/{workspace_id}/members/{member_id}/enable",
        headers=csrf_headers(client),
    )
    assert enabled.status_code == 200
    assert enabled.json()["membershipStatus"] == "active"

    self_disable = client.post(
        f"/api/workspaces/{workspace_id}/members/{workspace_admin_id}/disable",
        headers=csrf_headers(client),
    )
    assert self_disable.status_code == 409

    downgrade_last_admin = client.patch(
        f"/api/workspaces/{workspace_id}/members/{workspace_admin_id}",
        json={"role": "builder"},
        headers=csrf_headers(client),
    )
    assert downgrade_last_admin.status_code == 409


def test_reviewer_qualification_grant_update_and_revoke_are_audited(tmp_path):
    context = create_membership_context(tmp_path)
    client: TestClient = context["client"]
    session_factory = context["session_factory"]
    workspace_id = context["workspace_id"]
    workspace_admin_id = context["workspace_admin_id"]
    member_id = context["member_id"]

    login(client, WORKSPACE_ADMIN_EMAIL)

    granted = client.put(
        f"/api/workspaces/{workspace_id}/members/{workspace_admin_id}/reviewer",
        json={"role": "质量审核人", "isExpert": False},
        headers=csrf_headers(client),
    )
    assert granted.status_code == 200
    assert granted.json()["reviewer"] == {
        "role": "质量审核人",
        "isExpert": False,
        "isActive": True,
    }

    updated = client.put(
        f"/api/workspaces/{workspace_id}/members/{workspace_admin_id}/reviewer",
        json={"role": "质量专家", "isExpert": True},
        headers=csrf_headers(client),
    )
    assert updated.status_code == 200
    assert updated.json()["reviewer"] == {
        "role": "质量专家",
        "isExpert": True,
        "isActive": True,
    }

    revoked = client.delete(
        f"/api/workspaces/{workspace_id}/members/{workspace_admin_id}/reviewer",
        headers=csrf_headers(client),
    )
    assert revoked.status_code == 200
    assert revoked.json()["reviewer"]["isActive"] is False
    assert revoked.json()["reviewer"]["isExpert"] is False

    disabled = client.post(
        f"/api/workspaces/{workspace_id}/members/{member_id}/disable",
        headers=csrf_headers(client),
    )
    assert disabled.status_code == 200
    blocked = client.put(
        f"/api/workspaces/{workspace_id}/members/{member_id}/reviewer",
        json={"role": "不可授予", "isExpert": False},
        headers=csrf_headers(client),
    )
    assert blocked.status_code == 409

    with session_factory() as session:
        events = list(
            session.scalars(
                select(AuditEventRecord).where(
                    AuditEventRecord.action.in_(
                        ["reviewer.grant", "reviewer.update", "reviewer.revoke"],
                    ),
                ).order_by(AuditEventRecord.created_at.asc(), AuditEventRecord.id.asc()),
            ),
        )
        assert [event.action for event in events] == [
            "reviewer.grant",
            "reviewer.update",
            "reviewer.revoke",
        ]
        assert all(event.workspace_id == workspace_id for event in events)
        assert all(event.organization_id is not None for event in events)


def test_disabled_user_cannot_be_reinvited_or_reactivated(tmp_path):
    context = create_membership_context(tmp_path)
    client: TestClient = context["client"]
    session_factory = context["session_factory"]
    workspace_id = context["workspace_id"]

    login(client, WORKSPACE_ADMIN_EMAIL)
    created = invite_member(client, workspace_id, "blocked@example.com", "viewer")
    token = extract_token(created["activationUrl"])

    with session_factory() as session:
        blocked_user = session.scalar(
            select(UserRecord).where(UserRecord.normalized_email == "blocked@example.com"),
        )
        assert blocked_user is not None
        blocked_user_id = blocked_user.id

    login(client, "admin@example.com")
    disabled = client.post(
        f"/api/workspaces/{workspace_id}/members/{blocked_user_id}/user/disable",
        headers=csrf_headers(client),
    )
    assert disabled.status_code == 200
    assert disabled.json()["userStatus"] == "disabled"

    blocked_activation = client.post(
        f"/api/invitations/{token}/activate",
        json={"displayName": "Blocked", "password": "Activated Password 42!"},
    )
    assert blocked_activation.status_code == 409

    reinvite = client.post(
        f"/api/workspaces/{workspace_id}/invitations",
        json={"email": "blocked@example.com", "role": "viewer"},
        headers=csrf_headers(client),
    )
    assert reinvite.status_code == 409


def test_active_user_can_be_added_to_second_workspace_without_activation_link(tmp_path):
    context = create_membership_context(tmp_path)
    client: TestClient = context["client"]
    workspace_id = context["workspace_id"]

    login(client, "admin@example.com")
    created_workspace = client.post(
        "/api/workspaces",
        json={"name": "第二工作区", "slug": "second-workspace"},
        headers=csrf_headers(client),
    )
    assert created_workspace.status_code == 201
    second_workspace_id = created_workspace.json()["id"]
    assert second_workspace_id != workspace_id

    added = client.post(
        f"/api/workspaces/{second_workspace_id}/invitations",
        json={"email": MEMBER_EMAIL, "role": "operator"},
        headers=csrf_headers(client),
    )
    assert added.status_code == 201
    assert added.json()["email"] == MEMBER_EMAIL
    assert added.json()["activationUrl"] is None

    listed = client.get(f"/api/workspaces/{second_workspace_id}/members")
    assert listed.status_code == 200
    member = next(item for item in listed.json() if item["email"] == MEMBER_EMAIL)
    assert member["membershipStatus"] == "active"
    assert member["role"] == "operator"


def test_active_user_stale_invitation_cannot_reset_password(tmp_path):
    context = create_membership_context(tmp_path)
    client: TestClient = context["client"]
    workspace_id = context["workspace_id"]

    login(client, "admin@example.com")
    created_workspace = client.post(
        "/api/workspaces",
        json={"name": "第三工作区", "slug": "third-workspace"},
        headers=csrf_headers(client),
    )
    assert created_workspace.status_code == 201
    second_workspace_id = created_workspace.json()["id"]

    first = invite_member(client, workspace_id, "multi.invite@example.com", "viewer")
    second = invite_member(client, second_workspace_id, "multi.invite@example.com", "viewer")
    first_token = extract_token(first["activationUrl"])
    second_token = extract_token(second["activationUrl"])

    activated = client.post(
        f"/api/invitations/{first_token}/activate",
        json={
            "displayName": "Multi Invite",
            "password": "Activated Password 42!",
        },
    )
    assert activated.status_code == 204

    stale_activation = client.post(
        f"/api/invitations/{second_token}/activate",
        json={
            "displayName": "Multi Invite",
            "password": "Replacement Password 42!",
        },
    )
    assert stale_activation.status_code == 409
    login(client, "multi.invite@example.com", "Activated Password 42!")

    login(client, "admin@example.com")
    added = client.post(
        f"/api/workspaces/{second_workspace_id}/invitations",
        json={"email": "multi.invite@example.com", "role": "operator"},
        headers=csrf_headers(client),
    )
    assert added.status_code == 201
    assert added.json()["activationUrl"] is None
    stale_preview = client.get(f"/api/invitations/{second_token}")
    assert stale_preview.status_code == 409


def test_organization_admin_user_disable_enable_revokes_sessions_and_audits(tmp_path):
    context = create_membership_context(tmp_path)
    client: TestClient = context["client"]
    session_factory = context["session_factory"]
    workspace_id = context["workspace_id"]
    admin_id = context["admin_id"]
    member_id = context["member_id"]

    login(client, MEMBER_EMAIL)
    with session_factory() as session:
        active_session = session.scalar(
            select(SessionRecord).where(SessionRecord.user_id == member_id),
        )
        assert active_session is not None
        assert active_session.revoked_at is None

    login(client, "admin@example.com")
    disabled = client.post(
        f"/api/workspaces/{workspace_id}/members/{member_id}/user/disable",
        headers=csrf_headers(client),
    )
    assert disabled.status_code == 200
    assert disabled.json()["userStatus"] == "disabled"
    assert disabled.json()["membershipStatus"] == "active"

    enabled = client.post(
        f"/api/workspaces/{workspace_id}/members/{member_id}/user/enable",
        headers=csrf_headers(client),
    )
    assert enabled.status_code == 200
    assert enabled.json()["userStatus"] == "active"

    with session_factory() as session:
        revoked_session = session.get(SessionRecord, active_session.id)
        assert revoked_session is not None
        assert revoked_session.revoked_at is not None
        assert revoked_session.revoked_reason == "user_disabled"
        actions = {
            event.action: event
            for event in session.scalars(
                select(AuditEventRecord).where(AuditEventRecord.target_id == member_id),
            )
        }
        assert actions["user.disable"].organization_id is not None
        assert actions["user.disable"].workspace_id == workspace_id
        assert actions["user.enable"].organization_id is not None
        assert actions["user.enable"].workspace_id == workspace_id

    self_disable = client.post(
        f"/api/workspaces/{workspace_id}/members/{admin_id}/user/disable",
        headers=csrf_headers(client),
    )
    assert self_disable.status_code == 409
