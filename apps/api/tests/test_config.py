from app.config import Settings


def test_allowed_origins_accepts_zeabur_bracket_list(monkeypatch):
    monkeypatch.setenv("ALLOWED_ORIGINS", "[https://arc-v1-lite-lindabaoz.zeabur.app]")

    settings = Settings()

    assert settings.allowed_origins == ("https://arc-v1-lite-lindabaoz.zeabur.app",)


def test_allowed_origins_accepts_comma_separated_string(monkeypatch):
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://one.example, https://two.example")

    settings = Settings()

    assert settings.allowed_origins == (
        "https://one.example",
        "https://two.example",
    )
