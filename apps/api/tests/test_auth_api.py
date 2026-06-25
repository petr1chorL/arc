from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

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
from app.schemas import ChangePasswordCreate, LoginCreate


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


@pytest.mark.parametrize("cookie_secure", [True, False])
def test_auth_cookies_follow_secure_setting(
    tmp_path,
    clock,
    monkeypatch,
    cookie_secure,
):
    database_url = f"sqlite:///{tmp_path / f'cookie-{cookie_secure}.db'}"
    engine, session_factory = create_database(database_url)
    Base.metadata.create_all(engine)
    with session_factory() as session:
        bootstrap_organization_admin(
            session,
            SecurityService(),
            organization_name="安克创新",
            organization_slug="anker-innovation",
            email=ADMIN_EMAIL,
            display_name="平台管理员",
            password=ADMIN_PASSWORD,
            clock=clock,
        )
    monkeypatch.setenv("COOKIE_SECURE", str(cookie_secure).lower())
    client = TestClient(create_app(database_url, auth_clock=clock))

    response = login(client)

    assert response.status_code == 200
    cookies = response.headers.get_list("set-cookie")
    session_cookie = next(
        item for item in cookies if "arc_one_session=" in item
    )
    csrf_cookie = next(item for item in cookies if "arc_one_csrf=" in item)
    assert ("Secure" in session_cookie) is cookie_secure
    assert ("Secure" in csrf_cookie) is cookie_secure


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


def test_login_and_session_json_exclude_authentication_secrets(client):
    login_response = login(client)
    session_response = client.get("/api/auth/session")

    assert login_response.status_code == 200
    assert session_response.status_code == 200
    for response in (login_response, session_response):
        serialized = response.text.lower()
        assert "arc_one_session" not in serialized
        assert "arc_one_csrf" not in serialized
        assert "password_hash" not in serialized
        assert "passwordhash" not in serialized
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


def test_unknown_email_remains_uniform_401_without_account_lock(client):
    responses = [
        client.post(
            "/api/auth/login",
            json={
                "email": "missing@example.com",
                "password": "Wrong Password 12!",
            },
        )
        for _ in range(5)
    ]

    assert {response.status_code for response in responses} == {401}
    assert len({response.json()["detail"] for response in responses}) == 1


def test_successful_login_resets_failures_and_records_last_login(
    auth_context,
    clock,
):
    app, session_factory, admin_id = auth_context
    client = TestClient(app)
    for _ in range(4):
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

    clock.advance(minutes=15, seconds=1)
    assert login(client).status_code == 200

    with session_factory() as session:
        admin = session.get(UserRecord, admin_id)
        assert admin.failed_login_count == 0
        assert admin.locked_until is None
        assert aware_utc(admin.last_login_at) == clock.current


@pytest.mark.parametrize("status", ["invited", "pending_email", "disabled"])
def test_non_active_accounts_share_invalid_login_contract(
    auth_context,
    status,
):
    app, session_factory, admin_id = auth_context
    wrong_password = login(TestClient(app), "Wrong Password 12!")
    with session_factory() as session:
        admin = session.get(UserRecord, admin_id)
        admin.status = status
        session.commit()

    non_active = login(TestClient(app))

    assert wrong_password.status_code == 401
    assert non_active.status_code == 401
    assert non_active.json() == wrong_password.json()


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


def test_identity_records_enforce_approved_uniqueness_constraints(
    tmp_path,
    clock,
):
    engine, session_factory = create_database(
        f"sqlite:///{tmp_path / 'unique.db'}",
    )
    Base.metadata.create_all(engine)
    security = SecurityService()
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
        organization = session.scalar(select(OrganizationRecord))
        workspace = session.scalar(select(WorkspaceRecord))
        membership = session.scalar(select(WorkspaceMembershipRecord))
        auth_service = AuthenticationService(
            security,
            Settings(database_url=f"sqlite:///{tmp_path / 'unique.db'}"),
            clock=clock,
        )
        _, session_record, _, _ = auth_service.login(
            session,
            email=ADMIN_EMAIL,
            password=ADMIN_PASSWORD,
            ip_address=None,
            user_agent=None,
        )

        duplicates = [
            UserRecord(
                organization_id=organization.id,
                email="admin@example.com",
                normalized_email="admin@example.com",
                display_name="重复用户",
            ),
            WorkspaceRecord(
                organization_id=organization.id,
                name="重复 Workspace",
                slug=workspace.slug,
            ),
            WorkspaceMembershipRecord(
                workspace_id=workspace.id,
                user_id=admin.id,
                role="viewer",
            ),
            SessionRecord(
                user_id=admin.id,
                token_digest=session_record.token_digest,
                csrf_digest=security.digest_token("other-csrf"),
                created_at=clock.current,
                last_seen_at=clock.current,
                idle_expires_at=clock.current + timedelta(hours=8),
                absolute_expires_at=clock.current + timedelta(days=7),
            ),
            OrganizationRecord(
                name="重复组织 slug",
                slug=organization.slug,
            ),
        ]
        for duplicate in duplicates:
            session.add(duplicate)
            with pytest.raises(IntegrityError):
                session.flush()
            session.rollback()

        other_organization = OrganizationRecord(
            name="其他组织",
            slug="other-organization",
        )
        session.add(other_organization)
        session.flush()
        session.add(
            UserRecord(
                organization_id=other_organization.id,
                email="admin@example.com",
                normalized_email="admin@example.com",
                display_name="其他组织用户",
            ),
        )
        session.add(
            WorkspaceRecord(
                organization_id=other_organization.id,
                name="同 slug Workspace",
                slug=workspace.slug,
            ),
        )
        session.flush()

        assert membership.id is not None


def test_auth_schema_rejects_short_passwords_and_blank_email():
    invalid_payloads = [
        (LoginCreate, {"email": ADMIN_EMAIL, "password": "short"}),
        (LoginCreate, {"email": "   ", "password": ADMIN_PASSWORD}),
        (
            ChangePasswordCreate,
            {"currentPassword": "short", "newPassword": NEW_PASSWORD},
        ),
        (
            ChangePasswordCreate,
            {"currentPassword": ADMIN_PASSWORD, "newPassword": "short"},
        ),
    ]

    for schema, payload in invalid_payloads:
        with pytest.raises(ValidationError):
            schema.model_validate(payload)


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
    assert same_password.json()["detail"] == "新密码不能与当前密码相同"

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


@pytest.mark.parametrize(
    ("missing_name", "present_name", "present_value"),
    [
        (
            "ARC_ONE_ADMIN_EMAIL",
            "ARC_ONE_ADMIN_PASSWORD",
            "Secret Password 42!",
        ),
        (
            "ARC_ONE_ADMIN_PASSWORD",
            "ARC_ONE_ADMIN_EMAIL",
            "admin@example.com",
        ),
    ],
)
def test_bootstrap_cli_missing_environment_is_clear_and_never_prints_password(
    monkeypatch,
    capsys,
    missing_name,
    present_name,
    present_value,
):
    monkeypatch.delenv(missing_name, raising=False)
    monkeypatch.setenv(present_name, present_value)

    with pytest.raises(SystemExit) as error:
        main()

    output = capsys.readouterr()
    combined = f"{output.out}{output.err}{error.value}"
    assert missing_name in combined
    assert "Secret Password 42!" not in combined


def test_bootstrap_cli_creates_admin_without_printing_password(
    tmp_path,
    monkeypatch,
    capsys,
):
    database_url = f"sqlite:///{tmp_path / 'cli.db'}"
    password = "CLI Secret Password 42!"
    monkeypatch.setenv("DATABASE_URL", database_url)
    monkeypatch.setenv("ARC_ONE_ADMIN_EMAIL", ADMIN_EMAIL)
    monkeypatch.setenv("ARC_ONE_ADMIN_PASSWORD", password)
    monkeypatch.setenv("ARC_ONE_ADMIN_DISPLAY_NAME", "CLI 管理员")

    main()

    output = capsys.readouterr()
    assert ADMIN_EMAIL in output.out
    assert password not in f"{output.out}{output.err}"
    _, session_factory = create_database(database_url)
    with session_factory() as session:
        admin = session.scalar(select(UserRecord))
        assert admin.email == ADMIN_EMAIL
        assert admin.display_name == "CLI 管理员"
        assert admin.status == "active"
        assert SecurityService().verify_password(
            password,
            admin.password_hash,
        )


def test_legacy_business_api_remains_anonymous_until_task_four(tmp_path):
    client = TestClient(
        create_app(f"sqlite:///{tmp_path / 'anonymous-agents.db'}"),
    )

    response = client.get("/api/agents")

    assert response.status_code == 200
