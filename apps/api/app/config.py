from pathlib import Path

from pydantic import PositiveInt, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


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
    cookie_secure: bool = False
    model_api_key: str = ""
    model_base_url: str = "https://api.deepseek.com"
    model_default_model: str = "deepseek-v4-pro"
    model_input_usd_per_million_tokens: float = 0
    model_output_usd_per_million_tokens: float = 0
    model_timeout_seconds: float = 60
    tool_http_allowed_hosts: str | tuple[str, ...] = ()
    tool_http_timeout_seconds: float = 10

    @field_validator("allowed_origins", "tool_http_allowed_hosts", mode="after")
    @classmethod
    def parse_string_sequence(cls, value: str | tuple[str, ...] | list[str]) -> tuple[str, ...]:
        return _parse_string_sequence(value)

    model_config = SettingsConfigDict(
        env_file=API_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )
