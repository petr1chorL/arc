# V0.17B Tool / Skill 资产审计面板验收

## 范围

V0.17B 在 V0.17A 的资产审计 API 之上，为 Tool / Skill 资产库补充前端审计面板：

- `src/types.ts` 新增 `ToolSkillAssetAuditEvent`。
- `src/api/assetLibrary.ts` 新增 `getToolSkillAssetAuditEvents(workspaceId, assetId)`。
- `src/pages/AssetLibrary.tsx` 在资产加载后读取每个资产的审计事件，并在资产卡片展示「最近变更」。
- 创建、编辑、停用资产成功后会重新拉取该资产审计事件，避免用户操作后卡片仍为空。
- 页面只展示事件类型、结果和脱敏摘要，不展示 `apiKey`。

## 验收证据

- RED：`npx vitest run src/pages/AssetLibrary.test.tsx src/api/assetLibrary.test.ts --reporter verbose` 首次失败，原因是页面没有渲染「最近变更」。
- GREEN focused：`npx vitest run src/pages/AssetLibrary.test.tsx src/api/assetLibrary.test.ts --reporter verbose` 通过，2 个文件、8 项测试。
- 后端聚焦：`apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_tool_skill_assets_api.py::test_tool_skill_asset_audit_events_include_lifecycle_and_runtime_invocations -q` 通过。
- 全量前端：`npm run test -- --run` 通过，31 个文件、128 项测试。
- `npm run lint` 通过。
- `npm run build` 通过，保留既有 Vite chunk-size warning。
- `git diff --check` 通过，仅有 Windows LF/CRLF 提示。

## 浏览器验收

- 路由：`http://127.0.0.1:4173/w/ai-capability-center/settings/asset-library`。
- 发现并处理：浏览器最初看不到审计事件，是因为 8000 API 进程仍是旧代码，`/asset-library/{assetId}/audit-events` 返回 `Not Found`；已重启 API 进程后复验。
- 结果：资产卡片展示「最近变更」和 `tool_skill_asset.create`。
- 页面文本不包含 `apiKey`。
- 浏览器控制台 error 数量为 0。

## 非范围

- 不新增独立审计详情页。
- 不提供一键回滚或撤销执行。
- 不把审计接口失败展示成成功事件。
