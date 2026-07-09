from pathlib import Path
from typing import Annotated, Any

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic_settings import NoDecode
from sqlalchemy.engine import make_url


API_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATABASE_URL = f"sqlite:///{(API_ROOT / 'data' / 'arc_one.db').as_posix()}"


class Settings(BaseSettings):
    environment: str = "development"
    database_url: str = DEFAULT_DATABASE_URL
    allowed_origins: Annotated[list[str], NoDecode] = []
    allowed_hosts: Annotated[list[str], NoDecode] = ["localhost", "127.0.0.1", "testserver"]
    security_headers_enabled: bool = True
    hsts_enabled: bool = False
    session_cookie_name: str = "arc_one_session"
    csrf_cookie_name: str = "arc_one_csrf"
    session_idle_hours: int = 8
    session_absolute_days: int = 7
    invitation_hours: int = 72
    login_max_failures: int = 5
    login_lock_minutes: int = 15
    cookie_secure: bool = False
    model_api_key: str = ""
    model_base_url: str = "https://api.deepseek.com"
    model_default_model: str = "deepseek-v4-pro"
    model_input_usd_per_million_tokens: float = 0
    model_output_usd_per_million_tokens: float = 0
    model_timeout_seconds: float = 60

    @field_validator("allowed_origins", "allowed_hosts", mode="before")
    @classmethod
    def parse_csv_list(cls, value: Any) -> list[str] | Any:
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    @property
    def is_production(self) -> bool:
        return self.environment.strip().lower() == "production"

    def validate_production_ready(self, database_url: str) -> None:
        if not self.is_production:
            return

        errors: list[str] = []
        url = make_url(database_url)
        if not url.drivername.startswith("postgresql"):
            errors.append("DATABASE_URL must use PostgreSQL in production")
        if not any(origin.startswith("https://") for origin in self.allowed_origins):
            errors.append("ALLOWED_ORIGINS must include at least one HTTPS origin")
        public_hosts = [
            host for host in self.allowed_hosts
            if host not in {"localhost", "127.0.0.1", "testserver"}
        ]
        if not public_hosts:
            errors.append("ALLOWED_HOSTS must include the public API host")
        if not self.hsts_enabled:
            errors.append("HSTS_ENABLED must be true in production")
        if not self.cookie_secure:
            errors.append("COOKIE_SECURE must be true in production")
        if not self.model_api_key:
            errors.append("MODEL_API_KEY must be set in production")

        if errors:
            raise RuntimeError("Unsafe production configuration: " + "; ".join(errors))

    model_config = SettingsConfigDict(
        env_file=API_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )
