from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


API_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATABASE_URL = f"sqlite:///{(API_ROOT / 'data' / 'arc_one.db').as_posix()}"


class Settings(BaseSettings):
    database_url: str = DEFAULT_DATABASE_URL

    model_config = SettingsConfigDict(
        env_file=API_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )
