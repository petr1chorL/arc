from pathlib import Path

from pydantic import PositiveInt
from pydantic_settings import BaseSettings, SettingsConfigDict


API_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATABASE_URL = f"sqlite:///{(API_ROOT / 'data' / 'arc_one.db').as_posix()}"


class Settings(BaseSettings):
    database_url: str = DEFAULT_DATABASE_URL
    session_cookie_name: str = "arc_one_session"
    csrf_cookie_name: str = "arc_one_csrf"
    session_idle_hours: PositiveInt = 8
    session_absolute_days: PositiveInt = 7
    invitation_hours: PositiveInt = 72
    login_max_failures: PositiveInt = 5
    login_lock_minutes: PositiveInt = 15
    allowed_origins: tuple[str, ...] = (
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

    model_config = SettingsConfigDict(
        env_file=API_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )
