import pytest
from argon2 import PasswordHasher
from argon2.exceptions import VerificationError
from pydantic import ValidationError

from app.config import Settings
from app.security import SecurityService


def test_password_hash_is_argon2_and_verifies():
    security = SecurityService()
    encoded = security.hash_password("Correct Horse Battery Staple 42!")

    assert encoded != "Correct Horse Battery Staple 42!"
    assert encoded.startswith("$argon2id$")
    assert security.verify_password("Correct Horse Battery Staple 42!", encoded)
    assert not security.verify_password("wrong password", encoded)


def test_password_verification_errors_are_rejected(monkeypatch):
    security = SecurityService()

    def raise_verification_error(self, encoded, password):
        raise VerificationError("verification failed")

    monkeypatch.setattr(
        PasswordHasher,
        "verify",
        raise_verification_error,
    )

    assert not security.verify_password("password", "encoded")


def test_session_token_is_random_and_only_digest_is_stable():
    security = SecurityService()
    first = security.new_token()
    second = security.new_token()

    assert first != second
    assert len(first) >= 43
    assert security.digest_token(first) == security.digest_token(first)
    assert security.digest_token(first) != security.digest_token(second)
    assert security.token_matches(first, security.digest_token(first))
    assert not security.token_matches(second, security.digest_token(first))


@pytest.mark.parametrize(
    "environment_variable",
    [
        "SESSION_IDLE_HOURS",
        "SESSION_ABSOLUTE_DAYS",
        "INVITATION_HOURS",
        "LOGIN_MAX_FAILURES",
        "LOGIN_LOCK_MINUTES",
    ],
)
def test_security_integer_settings_reject_zero(monkeypatch, environment_variable):
    monkeypatch.setenv(environment_variable, "0")

    with pytest.raises(ValidationError):
        Settings()


def test_security_settings_defaults():
    settings = Settings()

    assert settings.session_cookie_name == "arc_one_session"
    assert settings.csrf_cookie_name == "arc_one_csrf"
    assert settings.session_idle_hours == 8
    assert settings.session_absolute_days == 7
    assert settings.invitation_hours == 72
    assert settings.login_max_failures == 5
    assert settings.login_lock_minutes == 15
    assert settings.cookie_secure is False
