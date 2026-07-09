# V0.16D 验收说明：Tool / Skill 稳定资产引用

## 本版做了什么

V0.16D 把 Agent 对 Tool / Skill 的绑定从“只有名称数组”升级为“名称数组 + 稳定资产引用”。

- Agent 仍然兼容 `tools` / `skills` 名称数组，前端现有保存逻辑不需要改。
- 后端在保存 Agent 草稿时，同步生成 `toolAssetRefs` / `skillAssetRefs`。
- 后端在发布 Agent 版本时，把资产 ID、资产名称、资产类型、状态和适配器类型冻结进版本快照。
- Tool / Skill 改名后，影响面接口优先按资产 ID 匹配，不会因为名称变化丢失草稿或已发布版本。

## 如何验收

运行：

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_tool_skill_assets_api.py::test_tool_skill_asset_impact_survives_asset_rename_with_stable_refs -q
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_tool_skill_assets_api.py apps/api/tests/test_agent_lifecycle_api.py -q
```

预期：

- Agent PATCH 响应包含 `toolAssetRefs`。
- Agent 发布版本 `snapshot` 包含 `toolAssetRefs`。
- Tool 改名后，`/asset-library/{id}/impact` 仍显示 `draftAgents: 1`、`publishedVersions: 1`。
- Tool / Skill 创建、编辑、停用、影响面查询仍可用。
- 禁用资产仍不能被新 Agent 绑定。

## 当前验收状态

- RED：已确认新增测试首次失败，失败原因为响应缺少 `toolAssetRefs`。
- GREEN：已确认 focused 测试通过。
- 相关后端回归：已确认 11 项通过。
- 全量验证：已通过后端全量 pytest、前端 Vitest、lint、build 和 diff check。

## 边界说明

本版没有重做前端交互，也没有改变运行时 Tool 调用协议。前端仍提交名称数组，后端负责解析稳定引用。
