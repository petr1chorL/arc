# V0.15D Provider 变更审计与回滚辅助验收

## 本版完成

- 新增 Provider 最近审计接口：`GET /api/workspaces/{workspaceId}/model-providers/{providerId}/audit-events`。
- 接口复用已有 `AuditEventRecord`，按 Workspace 和 Provider 上下文筛选，默认返回最近 10 条，最多 50 条。
- 审计响应包含 `eventType`、`targetType`、`targetId`、`outcome`、`reason`、`actorId`、`createdAt` 和 `metadata`。
- Provider 草稿迁移审计 metadata 现在包含 `sourceProviderId`、`targetProviderId`、`reason` 和 `migratedAgentIds`。
- 模型 Provider 页面在每张 Provider 卡片中展示“最近变更”。
- 迁移事件展示目标 Provider 和迁移 Agent 数，作为回滚辅助信息；本版不提供一键回滚执行。
- 页面和响应不包含 `apiKey`。

## 自动化验证

- Backend focused：`apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_model_providers_api.py -q`
- Backend full：`apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q`
- Frontend focused：`npx vitest run src/api/modelProviders.test.ts src/pages/ModelProviders.test.tsx --reporter verbose`
- Frontend full：`$files = rg --files src | Where-Object { $_ -match '\.test\.(ts|tsx)$' }; npx vitest run @($files) --reporter verbose`
- Lint：`npm run lint`
- Build：`npm run build`
- Diff check：`git diff --check`

## 浏览器验收

- 页面：`http://127.0.0.1:4173/w/ai-capability-center/settings/model-providers`
- 操作：在现有 Provider 卡片中选择目标 Provider，填写 `V0.15D browser audit verification` 作为迁移原因并执行草稿迁移。
- 结果：页面出现“最近变更”、`model_provider.migrate_drafts`、迁移原因和“目标 Provider”；反馈显示“已迁移 0 个 Agent 草稿”。
- Console：新增 warning/error 数为 0。
- 截图：`.scratch/v0.15d-provider-audit.png`
- 结果 JSON：`.scratch/v0.15d-browser-result.json`

## 当前限制

- 本版只提供回滚辅助信息，不执行自动回滚。
- 审计记录来自现有审计表，暂未做独立 Provider 历史版本表。
- 迁移 Agent 清单当前在页面上展示数量；更详细的 Agent 名称清单可在后续审计详情面板中补齐。
