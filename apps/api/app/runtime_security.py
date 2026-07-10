import re
from urllib.parse import urlsplit

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AgentVersionRecord, ModelProviderRecord


MODEL_SECRET_REF_PATTERN = re.compile(r"[A-Z_][A-Z0-9_]*\Z")


def is_valid_model_secret_ref(value: str) -> bool:
    return bool(MODEL_SECRET_REF_PATTERN.fullmatch(value.strip()))


def is_allowed_model_base_url(
    value: str,
    allowed_hosts: tuple[str, ...],
) -> bool:
    try:
        parsed = urlsplit(value.strip())
    except ValueError:
        return False
    hostname = parsed.hostname
    if (
        parsed.scheme != "https"
        or not hostname
        or parsed.username is not None
        or parsed.password is not None
        or bool(parsed.query)
        or bool(parsed.fragment)
    ):
        return False
    normalized_hosts = {host.strip().lower() for host in allowed_hosts if host.strip()}
    return hostname.lower() in normalized_hosts


def purge_invalid_model_secret_refs(session: Session) -> int:
    changed = 0
    providers = session.scalars(select(ModelProviderRecord)).all()
    for provider in providers:
        if provider.secret_ref and not is_valid_model_secret_ref(provider.secret_ref):
            provider.secret_ref = ""
            changed += 1

    versions = session.scalars(select(AgentVersionRecord)).all()
    for version in versions:
        snapshot = version.snapshot if isinstance(version.snapshot, dict) else {}
        secret_ref = snapshot.get("modelSecretRef")
        if isinstance(secret_ref, str) and secret_ref and not is_valid_model_secret_ref(secret_ref):
            version.snapshot = {**snapshot, "modelSecretRef": ""}
            changed += 1
    return changed
