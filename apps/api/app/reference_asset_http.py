from fastapi import HTTPException, Request
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.reference_asset_policy import AssetConfigurationError, is_safe_registration_url, validate_adapter_config
from app.runtime_security import is_valid_model_secret_ref
from app.schemas import ToolSkillAssetInvocationRead
from app.models import AgentRecord, ModelProviderRecord, NodeRunRecord, ToolSkillAssetRecord, UserRecord, WorkflowRunRecord


HISTORY_ERROR = "存在不符合当前安全规则的历史资产或记录，需先完成治理"
HIDDEN_HISTORY_TEXT = "内容已隐藏（迁移安全策略）"


def historical_object(value: object) -> dict:
    """Reject malformed JSON before filtering or projecting historical records."""
    if not isinstance(value, dict):
        raise HTTPException(status_code=409, detail=HISTORY_ERROR)
    return value


def require_historical_version_agent(version, session, workspace_id: str) -> None:
    """Reject version projections that would expose a missing or foreign Agent."""
    snapshot = version.snapshot
    if not isinstance(snapshot, dict):
        raise HTTPException(status_code=409, detail=HISTORY_ERROR)
    _scoped_reference(session, AgentRecord, version.agent_id, workspace_id)
    if (snapshot.get("id", version.agent_id) != version.agent_id
            or not isinstance(snapshot.get("name", ""), str)):
        raise HTTPException(status_code=409, detail=HISTORY_ERROR)


def project_asset_audit(event, session, workspace) -> dict:
    """Project known audit metadata and validate migration references in scope."""
    raw = historical_object({} if event.event_metadata is None else event.event_metadata)
    targets = {"model_provider": ModelProviderRecord, "tool_skill_asset": ToolSkillAssetRecord}
    if event.outcome not in {"success", "denied"} or event.target_type not in {*targets, "workspace"}:
        raise HTTPException(status_code=409, detail=HISTORY_ERROR)
    if event.target_id is not None:
        if event.target_type == "workspace":
            if event.target_id != workspace.id:
                raise HTTPException(status_code=409, detail=HISTORY_ERROR)
        else:
            _scoped_reference(session, targets[event.target_type], event.target_id, workspace.id)
    action = event.action or event.event_type or ""
    known = {f"{domain}.{verb}" for domain in ("model_provider", "tool_skill_asset")
             for verb in ("create", "update", "deactivate", "list", "impact", "audit_events")}
    known.update({"model_provider.migrate_drafts", "tool_skill_asset.test_invoke"})
    metadata = {}
    if action == "model_provider.migrate_drafts" and event.outcome == "success":
        for key in ("sourceProviderId", "targetProviderId"):
            metadata[key] = _scoped_reference(session, ModelProviderRecord, raw.get(key), workspace.id)
        ids = raw.get("migratedAgentIds")
        if not isinstance(ids, list):
            raise HTTPException(status_code=409, detail=HISTORY_ERROR)
        metadata["migratedAgentIds"] = [_scoped_reference(session, AgentRecord, value, workspace.id) for value in ids]
        metadata["reason"] = hide_history_text(raw.get("reason", ""))
    if event.outcome == "denied" and action in known:
        capability = raw.get("capability")
        if not isinstance(capability, str) or capability not in {"agent.write", "asset.read", "asset.deactivate", "audit.read"}:
            raise HTTPException(status_code=409, detail=HISTORY_ERROR)
        metadata = {"capability": capability}
    actor_id = event.actor_user_id or event.actor_id
    if actor_id:
        actor = session.get(UserRecord, actor_id)
        if actor is None or actor.organization_id != workspace.organization_id:
            raise HTTPException(status_code=409, detail=HISTORY_ERROR)
    return {
        "id": event.id, "event_type": action if action in known else "unsupported_event",
        "target_type": event.target_type or "", "target_id": event.target_id or "",
        "outcome": event.outcome or "", "actor_id": actor_id, "created_at": event.created_at,
        "reason": hide_history_text(event.reason or raw.get("reason", "")) if action in known else HIDDEN_HISTORY_TEXT,
        "metadata": metadata,
    }


def _scoped_reference(session, record_type, value, workspace_id: str) -> str:
    if not isinstance(value, str):
        raise HTTPException(status_code=409, detail=HISTORY_ERROR)
    record = session.get(record_type, value)
    if record is None or record.workspace_id != workspace_id:
        raise HTTPException(status_code=409, detail=HISTORY_ERROR)
    return value


def hide_history_text(value: str) -> str:
    """Hide nonempty historical text without attempting secret detection."""
    if not isinstance(value, str):
        raise HTTPException(status_code=409, detail=HISTORY_ERROR)
    return HIDDEN_HISTORY_TEXT if value else ""


def project_invocation(record, session, workspace_id: str) -> ToolSkillAssetInvocationRead:
    """Build a response copy, never redact the persisted audit source."""
    _scoped_reference(session, ToolSkillAssetRecord, record.asset_id, workspace_id)
    for record_type, value in ((AgentRecord, record.agent_id), (WorkflowRunRecord, record.run_id),
                               (NodeRunRecord, record.node_run_id)):
        if value is not None:
            _scoped_reference(session, record_type, value, workspace_id)
    if (record.asset_type not in {"tool", "skill"} or record.status not in {"succeeded", "failed"}
            or type(record.duration_ms) is not int or record.duration_ms < 0):
        raise HTTPException(status_code=409, detail=HISTORY_ERROR)
    result = ToolSkillAssetInvocationRead.model_validate(record)
    return result.model_copy(update={field: hide_history_text(getattr(result, field)) for field in (
        "asset_name", "agent_version", "input_summary", "output_summary", "error",
    )})


async def asset_validation_error_handler(request: Request, error: RequestValidationError):
    """Keep unrelated validation contracts while suppressing asset input echoes."""
    parts = request.url.path.strip("/").split("/")
    if parts[:2] == ["api", "workspaces"] and (
        (len(parts) == 5 and parts[3:5] == ["evaluations", "rubrics"] and request.method == "POST")
        or (len(parts) == 6 and parts[3:5] == ["evaluations", "rubrics"] and request.method == "PATCH")
        or (len(parts) == 6 and parts[3] == "feedback-candidates" and parts[5] == "confirm" and request.method == "POST")
    ):
        return JSONResponse(status_code=422, content={"detail": "量规或样本请求字段不符合要求"})
    if (len(parts) in {4, 5, 6} and parts[:2] == ["api", "workspaces"] and parts[3] == "data-objects"
            and (len(parts) <= 5 or parts[5] in {"publish", "versions"})):
        return JSONResponse(status_code=422, content={"detail": "Data Object 请求字段不符合要求"})
    if (len(parts) >= 4 and parts[:2] == ["api", "workspaces"] and parts[3] == "agents"
            and (len(parts) <= 5 or (len(parts) == 6 and parts[5] == "publish"))):
        return JSONResponse(status_code=422, content={"detail": "Agent 请求字段不符合要求"})
    if len(parts) >= 4 and parts[:2] == ["api", "workspaces"] and parts[3] in {"asset-library", "model-providers"}:
        return JSONResponse(status_code=422, content={"detail": "资产请求字段不符合要求"})
    return await request_validation_exception_handler(request, error)


def require_provider_url(value: object, *, historical: bool = False) -> None:
    """Reject unsafe registration URLs without contacting the provider."""
    if not is_safe_registration_url(value):
        raise HTTPException(status_code=409 if historical else 422,
                            detail=HISTORY_ERROR if historical else "Provider 地址不符合安全登记规则")


def require_historical_provider(provider) -> None:
    """Check known credential-bearing fields before serializing legacy assets."""
    require_provider_url(provider.base_url, historical=True)
    if not isinstance(provider.secret_ref, str) or not is_valid_model_secret_ref(provider.secret_ref):
        raise HTTPException(status_code=409, detail=HISTORY_ERROR)


def require_historical_secret_ref(value: object) -> None:
    """Allow absent legacy bindings but never echo an invalid nonempty reference."""
    if not isinstance(value, str) or (value and not is_valid_model_secret_ref(value)):
        raise HTTPException(status_code=409, detail=HISTORY_ERROR)


def require_adapter_config(adapter_type: str, config: object, *, historical: bool = False) -> None:
    """Map registration policy failures to fixed API errors without raw input."""
    try:
        validate_adapter_config(adapter_type, config)
    except AssetConfigurationError:
        raise HTTPException(
            status_code=409 if historical else 422,
            detail=HISTORY_ERROR if historical else "资产配置包含不支持或不安全的字段",
        ) from None
