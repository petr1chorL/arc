import hashlib
import hmac
import secrets

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError


class SecurityService:
    def __init__(self) -> None:
        self.password_hasher = PasswordHasher()

    def hash_password(self, password: str) -> str:
        return self.password_hasher.hash(password)

    def verify_password(self, password: str, encoded: str) -> bool:
        try:
            return self.password_hasher.verify(encoded, password)
        except (VerifyMismatchError, InvalidHashError):
            return False

    @staticmethod
    def new_token() -> str:
        return secrets.token_urlsafe(32)

    @staticmethod
    def digest_token(token: str) -> str:
        return hashlib.sha256(token.encode("utf-8")).hexdigest()

    @staticmethod
    def token_matches(token: str, digest: str) -> bool:
        return hmac.compare_digest(
            SecurityService.digest_token(token),
            digest,
        )
