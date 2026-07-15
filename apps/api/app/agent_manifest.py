from ipaddress import ip_address
import re
from urllib.parse import urlsplit


REMOTE_AGENT_RUNTIME = "remote_http"
REMOTE_AGENT_SOURCE_TYPE = "remote_api"
REMOTE_AGENT_PROTOCOL_VERSION = "arc-agent-v1"
REMOTE_AGENT_TIMEOUT_MIN_SECONDS = 1
REMOTE_AGENT_TIMEOUT_MAX_SECONDS = 60
REMOTE_AGENT_MANIFEST_FIELDS = {
    "runtime",
    "sourceType",
    "protocolVersion",
    "endpointUrl",
    "secretRef",
    "timeoutSeconds",
}
SECRET_REF_PATTERN = re.compile(r"[A-Z_][A-Z0-9_]*\Z")


def normalize_agent_runtime_manifest(value: object) -> dict:
    if not isinstance(value, dict):
        raise ValueError("runtimeManifest 必须是对象")
    if not value:
        return {}
    if set(value) != REMOTE_AGENT_MANIFEST_FIELDS:
        raise ValueError("runtimeManifest 仅支持远程 Agent API 的固定字段")
    if (
        value.get("runtime") != REMOTE_AGENT_RUNTIME
        or value.get("sourceType") != REMOTE_AGENT_SOURCE_TYPE
        or value.get("protocolVersion") != REMOTE_AGENT_PROTOCOL_VERSION
    ):
        raise ValueError("仅支持平台内置运行或远程 Agent API")

    endpoint_url = str(value.get("endpointUrl") or "").strip()
    if not is_structurally_valid_agent_api_url(endpoint_url):
        raise ValueError("Agent API 地址必须是完整、无凭证和查询参数的 HTTPS URL")

    secret_ref = str(value.get("secretRef") or "").strip()
    if not SECRET_REF_PATTERN.fullmatch(secret_ref):
        raise ValueError("Secret Ref 必须是后端环境变量名")

    timeout_seconds = value.get("timeoutSeconds")
    if (
        isinstance(timeout_seconds, bool)
        or not isinstance(timeout_seconds, int)
        or not REMOTE_AGENT_TIMEOUT_MIN_SECONDS
        <= timeout_seconds
        <= REMOTE_AGENT_TIMEOUT_MAX_SECONDS
    ):
        raise ValueError("请求超时必须是 1-60 秒的整数")

    return {
        "runtime": REMOTE_AGENT_RUNTIME,
        "sourceType": REMOTE_AGENT_SOURCE_TYPE,
        "protocolVersion": REMOTE_AGENT_PROTOCOL_VERSION,
        "endpointUrl": endpoint_url,
        "secretRef": secret_ref,
        "timeoutSeconds": timeout_seconds,
    }


def is_remote_agent_api_manifest(value: object) -> bool:
    return (
        isinstance(value, dict)
        and value.get("runtime") == REMOTE_AGENT_RUNTIME
        and value.get("sourceType") == REMOTE_AGENT_SOURCE_TYPE
    )


def is_legacy_python_package_manifest(value: object) -> bool:
    return (
        isinstance(value, dict)
        and (
            value.get("sourceType") == "python_package"
            or value.get("runtime") == "langchain"
        )
    )


def is_structurally_valid_agent_api_url(value: str) -> bool:
    if not value or any(character.isspace() for character in value):
        return False
    try:
        parsed = urlsplit(value)
        hostname = parsed.hostname
        port = parsed.port
    except ValueError:
        return False
    if (
        parsed.scheme.lower() != "https"
        or not hostname
        or parsed.username is not None
        or parsed.password is not None
        or bool(parsed.query)
        or bool(parsed.fragment)
        or port not in {None, 443}
    ):
        return False
    try:
        ip_address(hostname)
    except ValueError:
        return True
    return False
