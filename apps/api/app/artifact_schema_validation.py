import json
from typing import Any


def _is_object(value: Any) -> bool:
    return isinstance(value, dict)


def _matches_type(value: Any, schema_type: str) -> bool:
    if schema_type == "string":
        return isinstance(value, str)
    if schema_type == "number":
        return isinstance(value, int | float) and not isinstance(value, bool)
    if schema_type == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if schema_type == "boolean":
        return isinstance(value, bool)
    if schema_type == "object":
        return _is_object(value)
    return True


def validate_artifact_schema(content: str, snapshot: dict | None) -> dict:
    schema = snapshot.get("schema") if snapshot else None
    if not _is_object(schema) or schema.get("type") != "object":
        return {
            "status": "unchecked",
            "label": "未校验",
            "reasons": ["未绑定可校验的对象 Schema"],
        }

    try:
        payload = json.loads(content)
    except json.JSONDecodeError:
        return {
            "status": "failed",
            "label": "Schema 校验失败",
            "reasons": ["内容不是合法 JSON 对象"],
        }

    if not _is_object(payload):
        return {
            "status": "failed",
            "label": "Schema 校验失败",
            "reasons": ["内容不是合法 JSON 对象"],
        }

    reasons: list[str] = []
    required = schema.get("required")
    if isinstance(required, list):
        for field in required:
            if isinstance(field, str) and field not in payload:
                reasons.append(f"缺少必填字段：{field}")

    properties = schema.get("properties")
    if isinstance(properties, dict):
        for field, definition in properties.items():
            if field not in payload or not isinstance(definition, dict):
                continue
            schema_type = definition.get("type")
            if isinstance(schema_type, str) and not _matches_type(payload[field], schema_type):
                reasons.append(f"字段 {field} 类型应为 {schema_type}")

    if reasons:
        return {
            "status": "failed",
            "label": "Schema 校验失败",
            "reasons": reasons,
        }
    return {
        "status": "passed",
        "label": "Schema 校验通过",
        "reasons": [],
    }
