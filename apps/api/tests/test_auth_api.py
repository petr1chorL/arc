from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.auth import AuthenticationService, aware_utc
from app.bootstrap import (
    bootstrap_default_workspace,
    bootstrap_organization_admin,
    main,
)
from app.config import Settings
from app.database import create_database
from app.main import create_app
from app.models import (
    Base,
    OrganizationRecord,
    SessionRecord,
    UserRecord,
    WorkspaceMembershipRecord,
    WorkspaceRecord,
)
from app.security import SecurityService


ADMIN_EMAIL = "Admin@Example.com"
ADMIN_PASSWORD = "Admin Password 42!"
NEW_PASSWORD = "New Admin Password 43!"


class MutableClock:
    def __init__(self, current: datetime):
        self.current = current

    def __call__(self) -> datetime:
        return self.current

    def advance(self, **kwargs: int) -> None:
        self.current += timedelta(**kwargs)


@pytest.fixture
def clock() -> MutableClock:
    return MutableClock(datetime(2026, 6, 25, 8, 0, tzinfo=timezone.utc))


@pytest.fixture
def auth_context(tmp_path, clock):
    database_url = f"sqlite:///{tmp_path / 'auth.db'}"
    engine, session_factory = create_database(database_url)
    Base.metadata.create_all(engine)
    with session_factory() as session:
        admin = bootstrap_organization_admin(
            session,
            SecurityService(),
            organization_name="安克创新",
            organization_slug="anker-innovation",
            email=ADMIN_EMAIL,
            display_name="平台管理员",
            password=ADMIN_PASSWORD,
            clock=clock,
        )
        admin_id = admin.id

    app = create_app(database_url, auth_clock=clock)
    return app, session_factory, admin_id


@pytest.fixture
def client(auth_context):
    app, _, _ = auth_context
    with TestClient(app) as test_client:
        yield test_client


def login(client: TestClient, password: str = ADMIN_PASSWORD):
    return client.post(
        "/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": password},
    )


def csrf_headers(client: TestClient) -> dict[str, str]:
    return {"X-CSRF-Token": client.cookies["arc_one_csrf"]}


def test_bootstrap_is_idempotent_and_creates_default_access(tmp_path, clock):
    engine, session_factory = create_database(
        f"sqlite:///{tmp_path / 'bootstrap.db'}",
    )
    Base.metadata.create_all(engine)
    security = SecurityService()

    with session_factory() as session:
        first = bootstrap_organization_admin(
            session,
            security,
            organization_name="安克创新",
            organization_slug="anker-innovation",
            email=ADMIN_EMAIL,
            display_name="平台管理员",
            password=ADMIN_PASSWORD,
            clock=clock,
        )
        second = bootstrap_organization_admin(
            session,
            security,
            organization_name="安克创新",
            organization_slug="anker-innovation",
            email=" admin@example.com ",
            display_name="不应重复创建",
            password="Different Password 99!",
            clock=clock,
        )

        assert first.id == second.id
        assert session.scalar(select(func.count()).select_from(OrganizationRecord)) == 1
        assert session.scalar(select(func.count()).select_from(WorkspaceRecord)) == 1
        assert session.scalar(select(func.count()).select_from(UserRecord)) == 1
        assert (
            session.scalar(
                select(func.count()).select_from(WorkspaceMembershipRecord),
            )
            == 1
        )
        organization = session.scalar(select(OrganizationRecord))
        workspace = session.scalar(select(WorkspaceRecord))
        membership = session.scalar(select(WorkspaceMembershipRecord))
        assert organization.name == "安克创新"
        assert organization.slug == "anker-innovation"
        assert workspace.name == "AI 能力中心"
        assert workspace.slug == "ai-capability-center"
        assert workspace.organization_id == organization.id
        assert first.status == "active"
        assert first.is_organization_admin is True
        assert first.normalized_email == "admin@example.com"
        assert security.verify_password(ADMIN_PASSWORD, first.password_hash)
        assert membership.workspace_id == workspace.id
        assert membership.user_id == first.id
        assert membership.role == "workspace_admin"
        assert membership.status == "active"


def test_bootstrap_reuses_pending_user_as_active_admin(tmp_path, clock):
    engine, session_factory = create_database(
        f"sqlite:///{tmp_path / 'pending-admin.db'}",
    )
    Base.metadata.create_all(engine)
    security = SecurityService()

    with session_factory() as session:
        organization, workspace = bootstrap_default_workspace(session)
        pending = UserRecord(
            organization_id=organization.id,
            email=ADMIN_EMAIL,
            normalized_email="admin@example.com",
            display_name="待补录用户",
            status="pending_email",
            is_organization_admin=False,
        )
        session.add(pending)
        session.commit()
        pending_id = pending.id

        admin = bootstrap_organization_admin(
            session,
            security,
            organization_name="安克创新",
            organization_slug="anker-innovation",
            email=ADMIN_EMAIL,
            display_name="平台管理员",
            password=ADMIN_PASSWORD,
            clock=clock,
        )

        assert admin.id == pending_id
        assert admin.status == "active"
        assert admin.is_organization_admin is True
        assert security.verify_password(ADMIN_PASSWORD, admin.password_hash)
        membership = session.scalar(
            select(WorkspaceMembershipRecord).where(
                WorkspaceMembershipRecord.workspace_id == workspace.id,
                WorkspaceMembershipRecord.user_id == admin.id,
            ),
        )
        assert membership.role == "workspace_admin"
        assert membership.status == "active"


def test_login_sets_session_and_csrf_cookies(client):
    response = login(client)

    assert response.status_code == 200
    assert response.json()["user"]["email"] == ADMIN_EMAIL
    cookies = response.headers.get_list("set-cookie")
    session_cookie = next(
        item for item in cookies if "arc_one_session=" in item
    )
    csrf_cookie = next(item for item in cookies if "arc_one_csrf=" in item)
    assert "HttpOnly" in session_cookie
    assert "HttpOnly" not in csrf_cookie
    assert "SameSite=lax" in session_cookie
    assert "SameSite=lax" in csrf_cookie
    assert "Path=/" in session_cookie
    assert "Path=/" in csrf_cookie


def test_session_requires_cookie_and_returns_only_user(client):
    assert client.get("/api/auth/session").status_code == 401

    assert login(client).status_code == 200
    response = client.get("/api/auth/session")

    assert response.status_code == 200
    assert response.json() == {
        "user": {
            "id": response.json()["user"]["id"],
            "email": ADMIN_EMAIL,
            "displayName": "平台管理员",
            "isOrganizationAdmin": True,
        },
    }
    serialized = response.text.lower()
    assert "csrf" not in serialized
    assert "token" not in serialized


def test_invalid_login_is_uniform_and_fifth_failure_locks_for_fifteen_minutes(
    client,
    clock,
):
    missing = client.post(
        "/api/auth/login",
        json={"email": "missing@example.com", "password": "Wrong Password 12!"},
    )
    first = client.post(
        "/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": "Wrong Password 12!"},
    )

    assert missing.status_code == 401
    assert first.status_code == 401
    assert missing.json() == first.json()

    for _ in range(3):
        response = client.post(
            "/api/auth/login",
            json={"email": ADMIN_EMAIL, "password": "Wrong Password 12!"},
        )
        assert response.status_code == 401

    locked = client.post(
        "/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": "Wrong Password 12!"},
    )
    assert locked.status_code == 429
    assert login(client).status_code == 429

    clock.advance(minutes=15, seconds=1)

    assert login(client).status_code == 200


def test_session_idle_expiry_absolute_expiry_and_sliding_cap(auth_context, clock):
    app, session_factory, _ = auth_context
    client = TestClient(app)
    assert login(client).status_code == 200

    clock.advance(hours=7)
    assert client.get("/api/auth/session").status_code == 200
    with session_factory() as session:
        record = session.scalar(select(SessionRecord))
        assert aware_utc(record.idle_expires_at) == (
            clock.current + timedelta(hours=8)
        )

    for _ in range(22):
        clock.advance(hours=7)
        assert client.get("/api/auth/session").status_code == 200

    with session_factory() as session:
        record = session.scalar(select(SessionRecord))
        assert aware_utc(record.idle_expires_at) == aware_utc(
            record.absolute_expires_at,
        )

    clock.current = aware_utc(record.absolute_expires_at)
    assert client.get("/api/auth/session").status_code == 401

    fresh_client = TestClient(app)
    assert login(fresh_client).status_code == 200
    clock.advance(hours=8, seconds=1)
    assert fresh_client.get("/api/auth/session").status_code == 401


def test_logout_requires_matching_csrf_revokes_session_and_clears_cookies(client):
    assert login(client).status_code == 200
    missing = client.post("/api/auth/logout")
    wrong = client.post(
        "/api/auth/logout",
        headers={"X-CSRF-Token": "wrong-token"},
    )

    assert missing.status_code == 403
    assert wrong.status_code == 403

    response = client.post("/api/auth/logout", headers=csrf_headers(client))

    assert response.status_code == 204
    cookies = response.headers.get_list("set-cookie")
    assert any("arc_one_session=" in item and "Max-Age=0" in item for item in cookies)
    assert any("arc_one_csrf=" in item and "Max-Age=0" in item for item in cookies)
    assert client.get("/api/auth/session").status_code == 401


def test_disabled_user_cannot_login_and_existing_session_stops_working(
    auth_context,
):
    app, session_factory, admin_id = auth_context
    client = TestClient(app)
    assert login(client).status_code == 200

    with session_factory() as session:
        admin = session.get(UserRecord, admin_id)
        admin.status = "disabled"
        session.commit()

    assert client.get("/api/auth/session").status_code == 401
    disabled_login = login(TestClient(app))
    assert disabled_login.status_code == 401


def test_change_password_validates_and_revokes_every_session(auth_context):
    app, _, _ = auth_context
    first_client = TestClient(app)
    second_client = TestClient(app)
    assert login(first_client).status_code == 200
    assert login(second_client).status_code == 200

    missing_csrf = first_client.post(
        "/api/auth/change-password",
        json={
            "currentPassword": ADMIN_PASSWORD,
            "newPassword": NEW_PASSWORD,
        },
    )
    wrong_current = first_client.post(
        "/api/auth/change-password",
        headers=csrf_headers(first_client),
        json={
            "currentPassword": "Wrong Current 12!",
            "newPassword": NEW_PASSWORD,
        },
    )
    same_password = first_client.post(
        "/api/auth/change-password",
        headers=csrf_headers(first_client),
        json={
            "currentPassword": ADMIN_PASSWORD,
            "newPassword": ADMIN_PASSWORD,
        },
    )

    assert missing_csrf.status_code == 403
    assert wrong_current.status_code == 422
    assert same_password.status_code == 422

    changed = first_client.post(
        "/api/auth/change-password",
        headers=csrf_headers(first_client),
        json={
            "currentPassword": ADMIN_PASSWORD,
            "newPassword": NEW_PASSWORD,
        },
    )

    assert changed.status_code == 204
    assert first_client.get("/api/auth/session").status_code == 401
    assert second_client.get("/api/auth/session").status_code == 401
    assert login(TestClient(app), ADMIN_PASSWORD).status_code == 401
    assert login(TestClient(app), NEW_PASSWORD).status_code == 200


def test_password_change_timestamp_invalidates_older_session(auth_context, clock):
    app, session_factory, admin_id = auth_context
    client = TestClient(app)
    assert login(client).status_code == 200

    clock.advance(seconds=1)
    with session_factory() as session:
        admin = session.get(UserRecord, admin_id)
        admin.password_changed_at = clock.current
        session.commit()

    assert client.get("/api/auth/session").status_code == 401


def test_login_rejects_cross_origin_and_allows_same_origin(client):
    rejected = client.post(
        "/api/auth/login",
        headers={"Origin": "https://attacker.example"},
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
    )
    allowed = client.post(
        "/api/auth/login",
        headers={"Origin": "http://testserver"},
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
    )

    assert rejected.status_code == 403
    assert allowed.status_code == 200


def test_authentication_service_stores_only_token_digests(tmp_path, clock):
    engine, session_factory = create_database(
        f"sqlite:///{tmp_path / 'digests.db'}",
    )
    Base.metadata.create_all(engine)
    security = SecurityService()
    settings = Settings(database_url=f"sqlite:///{tmp_path / 'digests.db'}")
    service = AuthenticationService(security, settings, clock=clock)

    with session_factory() as session:
        admin = bootstrap_organization_admin(
            session,
            security,
            organization_name="安克创新",
            organization_slug="anker-innovation",
            email=ADMIN_EMAIL,
            display_name="平台管理员",
            password=ADMIN_PASSWORD,
            clock=clock,
        )
        _, record, raw_session, raw_csrf = service.login(
            session,
            email=admin.email,
            password=ADMIN_PASSWORD,
            ip_address="127.0.0.1",
            user_agent="pytest",
        )

        assert record.token_digest != raw_session
        assert record.csrf_digest != raw_csrf
        assert security.token_matches(raw_session, record.token_digest)
        assert security.token_matches(raw_csrf, record.csrf_digest)


def test_bootstrap_cli_missing_environment_is_clear_and_never_prints_password(
    monkeypatch,
    capsys,
):
    monkeypatch.delenv("ARC_ONE_ADMIN_EMAIL", raising=False)
    monkeypatch.setenv("ARC_ONE_ADMIN_PASSWORD", "Secret Password 42!")

    with pytest.raises(SystemExit) as error:
        main()

    output = capsys.readouterr()
    combined = f"{output.out}{output.err}{error.value}"
    assert "ARC_ONE_ADMIN_EMAIL" in combined
    assert "Secret Password 42!" not in combined
