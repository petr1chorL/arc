from pathlib import Path

from pydantic import PositiveInt, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import make_url


API_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATABASE_URL = f"sqlite:///{(API_ROOT / 'data' / 'arc_one.db').as_posix()}"


def _parse_string_sequence(value: str | tuple[str, ...] | list[str]) -> tuple[str, ...]:
    if isinstance(value, tuple):
        return tuple(item.strip() for item in value if item.strip())
    if isinstance(value, list):
        return tuple(str(item).strip() for item in value if str(item).strip())

    stripped = value.strip()
    if not stripped:
        return ()
    if stripped.startswith("[") and stripped.endswith("]"):
        stripped = stripped[1:-1]
    return tuple(
        item.strip().strip('"').strip("'")
        for item in stripped.split(",")
        if item.strip().strip('"').strip("'")
    )


class Settings(BaseSettings):
    environment: str = "development"
    database_url: str = DEFAULT_DATABASE_URL
    session_cookie_name: str = "arc_one_session"
    csrf_cookie_name: str = "arc_one_csrf"
    session_idle_hours: PositiveInt = 8
    session_absolute_days: PositiveInt = 7
    invitation_hours: PositiveInt = 72
    login_max_failures: PositiveInt = 5
    login_lock_minutes: PositiveInt = 15
    allowed_origins: str | tuple[str, ...] = (
        "http://127.0.0.1:4173",
        "http://localhost:4173",
    )
    allowed_hosts: str | tuple[str, ...] = (
        "localhost",
        "127.0.0.1",
        "testserver",
    )
    security_headers_enabled: bool = True
    hsts_enabled: bool = False
    max_request_body_bytes: PositiveInt = 1_048_576
    rate_limit_enabled: bool = True
    rate_limit_requests: PositiveInt = 120
    rate_limit_window_seconds: PositiveInt = 60
    cookie_secure: bool = False
    model_api_key: str = ""
    model_base_url: str = "https://api.deepseek.com"
    model_allowed_hosts: str | tuple[str, ...] = ("api.deepseek.com",)
    model_default_model: str = "deepseek-v4-pro"
    model_input_usd_per_million_tokens: float = 0
    model_output_usd_per_million_tokens: float = 0
    model_timeout_seconds: float = 60
    tool_http_allowed_hosts: str | tuple[str, ...] = ()
    tool_http_timeout_seconds: float = 10
    agent_api_allowed_bindings: str | tuple[str, ...] = ()
    agent_api_max_response_bytes: PositiveInt = 1_048_576

    @field_validator(
        "allowed_origins",
        "allowed_hosts",
        "model_allowed_hosts",
        "tool_http_allowed_hosts",
        "agent_api_allowed_bindings",
        mode="after",
    )
    @classmethod
    def parse_string_sequence(cls, value: str | tuple[str, ...] | list[str]) -> tuple[str, ...]:
        return _parse_string_sequence(value)

    @property
    def is_production(self) -> bool:
        return self.environment.strip().lower() == "production"

    def validate_production_ready(self, database_url: str) -> None:
        if not self.is_production:
            return

        errors: list[str] = []
        if not make_url(database_url).drivername.startswith("postgresql"):
            errors.append("DATABASE_URL must use PostgreSQL in production")
        if any(
            origin == "*" or not origin.startswith("https://")
            for origin in self.allowed_origins
        ):
            errors.append("ALLOWED_ORIGINS must be empty or contain only HTTPS origins")
        public_hosts = {
            host
            for host in self.allowed_hosts
            if host not in {"localhost", "127.0.0.1", "testserver"}
        }
        if not public_hosts or "*" in public_hosts:
            errors.append("ALLOWED_HOSTS must include the public API host")
        if not self.hsts_enabled:
            errors.append("HSTS_ENABLED must be true in production")
        if not self.cookie_secure:
            errors.append("COOKIE_SECURE must be true in production")
        if not self.rate_limit_enabled:
            errors.append("RATE_LIMIT_ENABLED must be true in production")

        if errors:
            raise RuntimeError("Unsafe production configuration: " + "; ".join(errors))

    model_config = SettingsConfigDict(
        env_file=API_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )
