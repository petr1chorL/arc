"""Registration-only Agent rules; never resolve credentials or contact endpoints."""
from app.reference_asset_policy import is_safe_registration_url
from app.agent_manifest import normalize_agent_runtime_manifest, SECRET_REF_PATTERN
from fastapi import HTTPException
from sqlalchemy.orm import Session
from app.models import AgentRecord, ModelProviderRecord, ToolSkillAssetRecord


AGENT_HISTORY_ERROR = "存在不符合当前安全规则的历史 Agent 或版本，需先完成治理"


def normalize_agent_model_url(value: str) -> str:
    """Allow the legacy empty model URL, otherwise require safe HTTPS structure."""
    normalized = value.strip()
    if normalized and not is_safe_registration_url(normalized):
        raise ValueError("Agent 模型地址不符合安全登记规则")
    return normalized


def require_agent_snapshot_configuration(snapshot: object) -> None:
    """Validate persisted configuration without normalizing or modifying its source."""
    if not isinstance(snapshot, dict):
        raise HTTPException(status_code=409, detail=AGENT_HISTORY_ERROR)
    url = snapshot.get("modelBaseUrl", "")
    manifest = snapshot.get("runtimeManifest", {})
    secret = snapshot.get("modelSecretRef", "")
    try:
        if (not isinstance(url, str) or normalize_agent_model_url(url) != url
                or normalize_agent_runtime_manifest(manifest) != manifest
                or not isinstance(secret, str) or (secret and not SECRET_REF_PATTERN.fullmatch(secret))):
            raise ValueError("Invalid historical Agent configuration")
    except (ValueError, TypeError):
        raise HTTPException(status_code=409, detail=AGENT_HISTORY_ERROR) from None


def require_agent_configuration(record) -> None:
    """Guard the live Agent projection using the same rules as version configuration."""
    require_agent_snapshot_configuration({"modelBaseUrl": record.model_base_url,
                                          "runtimeManifest": record.runtime_manifest})


def require_agent_references(session: Session, workspace_id: str, snapshot: dict) -> None:
    """Check ownership, not current enablement, without rewriting historical bindings."""
    provider_id = snapshot.get("modelProviderId")
    with session.no_autoflush:
        if provider_id is not None:
            if not isinstance(provider_id, str) or not provider_id:
                raise HTTPException(status_code=409, detail=AGENT_HISTORY_ERROR)
            provider = session.get(ModelProviderRecord, provider_id)
            if provider is None or provider.workspace_id != workspace_id:
                raise HTTPException(status_code=409, detail=AGENT_HISTORY_ERROR)
        for kind in ("tool", "skill"):
            refs = snapshot.get(f"{kind}AssetRefs", [])
            if not isinstance(refs, list):
                raise HTTPException(status_code=409, detail=AGENT_HISTORY_ERROR)
            for ref in refs:
                if (not isinstance(ref, dict) or not isinstance(ref.get("assetId"), str)
                        or not ref["assetId"] or ref.get("assetType") != kind
                        or any(not isinstance(ref.get(field), str) for field in ("assetName", "status", "adapterType"))):
                    raise HTTPException(status_code=409, detail=AGENT_HISTORY_ERROR)
                asset = session.get(ToolSkillAssetRecord, ref["assetId"])
                if asset is None or asset.workspace_id != workspace_id or asset.asset_type != kind:
                    raise HTTPException(status_code=409, detail=AGENT_HISTORY_ERROR)


def require_agent_record_references(session: Session, record: AgentRecord) -> None:
    """Apply historical reference ownership checks to the live Agent projection."""
    require_agent_references(session, record.workspace_id, {
        "modelProviderId": record.model_provider_id,
        "toolAssetRefs": record.tool_asset_refs,
        "skillAssetRefs": record.skill_asset_refs,
    })
