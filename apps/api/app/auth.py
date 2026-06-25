from collections.abc import Callable
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.config import Settings
from app.models import SessionRecord, UserRecord, utc_now
from app.security import SecurityService


INVALID_LOGIN_MESSAGE = "邮箱或密码错误"


class AuthenticationError(Exception):
    pass


class AccountLocked(AuthenticationError):
    pass


class CsrfError(Exception):
    pass


class PasswordChangeError(Exception):
    pass


def normalize_email(email: str) -> str:
    return email.strip().casefold()


def aware_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


class AuthenticationService:
    def __init__(
        self,
        security: SecurityService,
        settings: Settings,
        *,
        clock: Callable[[], datetime] = utc_now,
    ) -> None:
        self.security = security
        self.settings = settings
        self.clock = clock

    def _now(self) -> datetime:
        return aware_utc(self.clock())

    def login(
        self,
        session: Session,
        *,
        email: str,
        password: str,
        ip_address: str | None,
        user_agent: str | None,
    ) -> tuple[UserRecord, SessionRecord, str, str]:
        now = self._now()
        user = session.scalar(
            select(UserRecord).where(
                UserRecord.normalized_email == normalize_email(email),
            ),
        )
        if user is None:
            raise AuthenticationError(INVALID_LOGIN_MESSAGE)

        if user.locked_until is not None:
            locked_until = aware_utc(user.locked_until)
            if locked_until > now:
                raise AccountLocked(INVALID_LOGIN_MESSAGE)
            user.failed_login_count = 0
            user.locked_until = None

        password_valid = (
            user.password_hash is not None
            and self.security.verify_password(password, user.password_hash)
        )
        if user.status != "active" or not password_valid:
            user.failed_login_count += 1
            user.updated_at = now
            if user.failed_login_count >= self.settings.login_max_failures:
                user.locked_until = now + timedelta(
                    minutes=self.settings.login_lock_minutes,
                )
                session.commit()
                raise AccountLocked(INVALID_LOGIN_MESSAGE)
            session.commit()
            raise AuthenticationError(INVALID_LOGIN_MESSAGE)

        raw_session_token = self.security.new_token()
        raw_csrf_token = self.security.new_token()
        absolute_expires_at = now + timedelta(
            days=self.settings.session_absolute_days,
        )
        record = SessionRecord(
            user_id=user.id,
            token_digest=self.security.digest_token(raw_session_token),
            csrf_digest=self.security.digest_token(raw_csrf_token),
            created_at=now,
            last_seen_at=now,
            idle_expires_at=min(
                now + timedelta(hours=self.settings.session_idle_hours),
                absolute_expires_at,
            ),
            absolute_expires_at=absolute_expires_at,
            ip_address=ip_address,
            user_agent=user_agent,
        )
        user.failed_login_count = 0
        user.locked_until = None
        user.last_login_at = now
        user.updated_at = now
        session.add(record)
        session.commit()
        session.refresh(record)
        return user, record, raw_session_token, raw_csrf_token

    def authenticate_session(
        self,
        session: Session,
        token: str | None,
    ) -> tuple[UserRecord, SessionRecord]:
        if not token:
            raise AuthenticationError("未登录或会话已失效")
        record = session.scalar(
            select(SessionRecord).where(
                SessionRecord.token_digest == self.security.digest_token(token),
            ),
        )
        if record is None or record.revoked_at is not None:
            raise AuthenticationError("未登录或会话已失效")

        now = self._now()
        user = session.get(UserRecord, record.user_id)
        reason: str | None = None
        if aware_utc(record.idle_expires_at) <= now:
            reason = "idle_expired"
        elif aware_utc(record.absolute_expires_at) <= now:
            reason = "absolute_expired"
        elif user is None or user.status != "active":
            reason = "user_inactive"
        elif (
            user.password_changed_at is not None
            and aware_utc(user.password_changed_at) > aware_utc(record.created_at)
        ):
            reason = "password_changed"

        if reason is not None:
            record.revoked_at = now
            record.revoked_reason = reason
            session.commit()
            raise AuthenticationError("未登录或会话已失效")

        record.last_seen_at = now
        record.idle_expires_at = min(
            now + timedelta(hours=self.settings.session_idle_hours),
            aware_utc(record.absolute_expires_at),
        )
        session.commit()
        session.refresh(record)
        return user, record

    def require_csrf(
        self,
        session_record: SessionRecord,
        csrf_token: str | None,
    ) -> None:
        if (
            not csrf_token
            or not self.security.token_matches(
                csrf_token,
                session_record.csrf_digest,
            )
        ):
            raise CsrfError("CSRF 校验失败")

    def revoke_session(
        self,
        session: Session,
        session_record: SessionRecord,
        reason: str,
    ) -> None:
        if session_record.revoked_at is None:
            session_record.revoked_at = self._now()
            session_record.revoked_reason = reason
            session.commit()

    def change_password(
        self,
        session: Session,
        user: UserRecord,
        *,
        current_password: str,
        new_password: str,
    ) -> None:
        if (
            user.password_hash is None
            or not self.security.verify_password(
                current_password,
                user.password_hash,
            )
        ):
            raise PasswordChangeError("当前密码错误")
        if current_password == new_password:
            raise PasswordChangeError("新密码不能与当前密码相同")

        now = self._now()
        user.password_hash = self.security.hash_password(new_password)
        user.password_changed_at = now
        user.updated_at = now
        session.execute(
            update(SessionRecord)
            .where(
                SessionRecord.user_id == user.id,
                SessionRecord.revoked_at.is_(None),
            )
            .values(
                revoked_at=now,
                revoked_reason="password_changed",
            ),
        )
        session.commit()
