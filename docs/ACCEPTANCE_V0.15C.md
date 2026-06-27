# V0.15C Provider 草稿迁移验收

## 本版完成

- 新增 Provider 草稿迁移接口：`POST /api/workspaces/{workspaceId}/model-providers/{sourceProviderId}/migrate-drafts`。
- 请求只接收 `targetProviderId` 和 `reason`，不接收、不保存、不返回 `apiKey`。
- 迁移只更新当前可编辑 Agent 草稿的 Provider 绑定与模型配置。
- 已发布 AgentVersion 快照保持不可变，不会被迁移重写。
- 模型 Provider 页面新增每张 Provider 卡片内的“草稿迁移”表单，可选择目标 Provider、填写原因并执行。
- 迁移完成后页面刷新 Provider impact，并显示迁移数量反馈。

## 自动化验证

- Backend focused：`apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_model_providers_api.py apps/api/tests/test_agents_api.py apps/api/tests/test_execution_api.py -q`
- Backend full：`apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q`
- Frontend focused：`npx vitest run src/api/modelProviders.test.ts src/pages/ModelProviders.test.tsx --reporter verbose`
- Frontend full：`$files = rg --files src | Where-Object { $_ -match '\.test\.(ts|tsx)$' }; npx vitest run @($files) --reporter verbose`
- Lint：`npm run lint`
- Build：`npm run build`

## 浏览器验收

- 页面：`http://127.0.0.1:4173/w/ai-capability-center/settings/model-providers`
- 操作：创建源 Provider、目标 Provider，将 Agent `test` 绑定到源 Provider，再从源 Provider 执行草稿迁移。
- 结果：页面出现“已迁移 1 个 Agent 草稿”；Agent 详情页的“模型 Provider”已变为目标 Provider。
- Console：新增 error 数为 0。
- 截图：`.scratch/v0.15c-provider-migration.png`
- 结果 JSON：`.scratch/v0.15c-browser-result.json`

## 当前限制

- 只迁移当前 Workspace 内的 Agent 草稿，不支持跨 Workspace。
- 不迁移已发布 AgentVersion 快照。
- 暂不提供迁移撤销，后续应在 V0.15D 做审计详情与回滚辅助。
