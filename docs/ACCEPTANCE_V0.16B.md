# V0.16B Tool / Skill 生命周期与影响面验收

## 本版完成

- 新增 `PATCH /api/workspaces/{workspaceId}/asset-library/{assetId}`，支持更新名称、描述、参数 Schema、适配类型和适配配置。
- 新增 `POST /api/workspaces/{workspaceId}/asset-library/{assetId}/deactivate`，支持停用 Tool / Skill 资产。
- 新增 `GET /api/workspaces/{workspaceId}/asset-library/{assetId}/impact`，返回依赖该资产的 Agent 草稿和已发布 AgentVersion 快照。
- 停用资产后，Agent 草稿更新若继续绑定该 Tool / Skill，会返回 `422`。
- 已发布 AgentVersion 快照不会被停用操作改写。
- 资产库页面支持在资产卡片内编辑、保存、停用资产。
- 资产库页面展示“草稿 Agent”和“已发布版本”影响面指标及最近依赖名称。
- 页面和请求体不包含 `apiKey` 字段。

## 自动化验证

- Backend focused RED/GREEN：`apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_tool_skill_assets_api.py::test_update_and_deactivate_tool_skill_asset_blocks_new_agent_binding apps/api/tests/test_tool_skill_assets_api.py::test_tool_skill_asset_impact_lists_draft_agents_and_published_versions -q`
- Frontend API/Page focused：`npx vitest run src/pages/AssetLibrary.test.tsx src/api/assetLibrary.test.ts --reporter verbose`，2 个文件 7 项通过。
- Backend related：`apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_tool_skill_assets_api.py apps/api/tests/test_agent_lifecycle_api.py -q`，10 项通过。
- Frontend full：`$files = rg --files src | Where-Object { $_ -match '\.test\.(ts|tsx)$' }; npx vitest run @($files) --reporter verbose`，31 个文件 126 项通过。
- Backend full：`apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q`，全量通过。
- Lint：`npm run lint` 通过。
- Build：`npm run build` 通过，保留既有 Vite chunk-size warning。
- Diff check：`git diff --check` 通过，仅有 Windows LF/CRLF 提示。

## 浏览器验收

- 页面：`http://127.0.0.1:4173/w/ai-capability-center/settings/asset-library`
- 操作：创建 `浏览器验收 Tool` HTTP Tool，确认影响面显示 `草稿 Agent 0` 和 `已发布版本 0`；编辑为 `浏览器验收 Tool V2`；停用该资产。
- 结果：资产创建成功；影响面指标可见；编辑保存后名称更新；停用后卡片状态展示 `tool · http · disabled`。
- 安全检查：页面正文不包含 `apiKey`。
- Console：新增 warning/error 数为 0。

## 当前限制

- 本版不提供 Tool / Skill 版本化、恢复启用、批量替换或自动回滚。
- 影响面按当前资产名称匹配 Agent 草稿和已发布快照；后续资产版本化后应切换为稳定资产引用。
- 停用不会改写已发布 AgentVersion 快照，只阻止新的草稿绑定和发布校验。
