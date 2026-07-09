# V0.17A 验收说明：Tool / Skill 资产审计流

## 本版做了什么

V0.17A 新增 Tool / Skill 资产级审计流接口：

```text
GET /api/workspaces/{workspaceId}/asset-library/{assetId}/audit-events
```

接口会聚合两类证据：

- 平台审计事件：创建、编辑、停用、测试调用等 `tool_skill_asset.*` 操作。
- 运行时调用记录：Agent test run 或工作流 Agent 节点产生的 Tool 调用记录，映射为 `tool_skill_asset.invocation`。

接口使用 `audit.read` 权限控制，viewer 不能读取。

## 如何验收

运行：

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_tool_skill_assets_api.py::test_tool_skill_asset_audit_events_include_lifecycle_and_runtime_invocations apps/api/tests/test_tool_skill_assets_api.py::test_viewer_cannot_read_tool_skill_asset_audit_events -q
```

预期：

- 创建、编辑、停用 Tool 后，审计流包含 `tool_skill_asset.create`、`tool_skill_asset.update`、`tool_skill_asset.deactivate`。
- Agent 运行调用 Tool 后，审计流包含 `tool_skill_asset.invocation`。
- 调用事件 metadata 包含 `assetId`、`agentId`、`agentVersion`、`runId`。
- viewer 读取资产审计流返回 403。
- 响应不包含 `apiKey`。

## 当前验收状态

- RED：已确认接口首次返回 404。
- GREEN：已确认审计流主路径 focused 测试通过。
- 权限：已确认 viewer 读取返回 403。
- 相关后端回归：`test_tool_skill_assets_api.py`、`test_tool_runtime_api.py`、`test_workspace_access_api.py` 共 32 项通过。
- 全量验证：已通过后端全量 pytest、前端 Vitest、lint、build 和 diff check。

## 边界说明

本版只提供后端聚合接口，不新增前端审计面板，也不提供一键回滚。
