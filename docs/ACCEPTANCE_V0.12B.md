# V0.12B Tool / Skill 资产库验收记录

## 当前切片目标

建立第一版 Workspace 级 Tool / Skill 资产库后端，支持创建和列表查询，并让 Agent 只能绑定当前 Workspace 中已存在且启用的 Tool / Skill 资产。

## 已实现能力

- 新增 `ToolSkillAssetRecord`，使用 `tool_skill_assets` 表保存 Workspace 级资产。
- 资产类型支持 `tool` 和 `skill`。
- 资产字段包含名称、描述、参数 Schema、状态、创建人、创建时间和更新时间。
- `POST /asset-library` 可创建资产。
- `GET /asset-library` 可查询当前 Workspace 的资产。
- 同一 Workspace 下同类型同名资产返回 409。
- 不同类型可使用同名资产。
- 跨 Workspace 查询不会泄露资产。
- 观察者无权创建资产。
- Agent 更新时会校验 `tools` 和 `skills` 必须存在且处于 `active` 状态。
- Agent 发布时会重新校验已绑定资产，避免禁用资产进入不可变版本快照。

## 验收命令

- RED：`apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_tool_skill_assets_api.py -q` 首次 4 条失败，原因是 `/asset-library` 路由不存在。
- GREEN focused：`apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_tool_skill_assets_api.py -q`：4 条通过。
- Agent 授权 RED：`apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_agent_lifecycle_api.py::test_agent_can_only_bind_existing_active_tool_and_skill_assets apps/api/tests/test_agent_lifecycle_api.py::test_agent_publish_revalidates_bound_tool_and_skill_assets -q` 首次 2 条失败，原因是任意字符串工具可保存且禁用资产仍可发布。
- Agent 授权 GREEN：同一 focused 命令 2 条通过。
- 交界测试：`apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_agent_lifecycle_api.py apps/api/tests/test_execution_api.py apps/api/tests/test_tool_skill_assets_api.py -q`：15 条通过。
- 后端全量：`apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q`：全量通过。
- `npm run lint`：通过。
- `npm run build`：通过。

## 尚未完成

- Tool / Skill 调用日志。
- Runtime 真实工具调用。
- 前端资产库页面。

## 已知非阻断警告

- Pytest 仍有既有 `StarletteDeprecationWarning`。
- Vite build 仍有既有 chunk size warning。
