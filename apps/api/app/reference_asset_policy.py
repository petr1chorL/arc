import re
from urllib.parse import urlsplit


HOST_LABEL = re.compile(r"[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\Z")


def is_safe_registration_url(value: object) -> bool:
    """Check URL syntax only; this does not authorize an outbound request."""
    if not isinstance(value, str) or any(ord(char) < 32 or ord(char) == 127 for char in value):
        return False
    value = value.strip()
    if not 1 <= len(value) <= 500 or any(char in value for char in "\\?#"):
        return False
    try:
        parsed = urlsplit(value)
        host = parsed.hostname or ""
        # A DNS name, not an IPv4/IPv6 literal (including numeric URL aliases).
        labels = host.rstrip(".").split(".")
        numeric_suffix = re.fullmatch(r"(?:[0-9]+|0x[0-9a-f]+)", labels[-1], re.IGNORECASE)
        return bool(
            parsed.scheme == "https"
            and parsed.netloc
            and parsed.username is None
            and parsed.password is None
            and not parsed.netloc.endswith(":")
            and parsed.port in (None, 443)
            and len(host) <= 253
            and all(HOST_LABEL.fullmatch(label) for label in labels)
            and not numeric_suffix
        )
    except ValueError:
        return False


class AssetConfigurationError(ValueError):
    """A fixed public error that never includes rejected configuration."""

    def __init__(self):
        super().__init__("资产配置包含不支持或不安全的字段")


def validate_adapter_config(adapter_type: str, config: object) -> None:
    """Validate non-secret registration configuration without modifying it."""
    if not isinstance(config, dict):
        raise AssetConfigurationError()
    if adapter_type in {"manual", "mcp"} and not config:
        return
    if (
        adapter_type != "http"
        or set(config) - {"method", "url"}
        or config.get("method", "POST") not in ("GET", "POST")
        or not is_safe_registration_url(config.get("url"))
    ):
        raise AssetConfigurationError()
