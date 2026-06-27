# V0.15B Provider 影响面视图验收说明

## 本版目标

V0.15B 让模型 Provider 页面能回答“这个 Provider 影响哪些 Agent”：

- API 返回绑定该 Provider 的 Agent 草稿依赖。
- API 返回已发布 Agent 版本快照中的 Provider 依赖。
- 页面展示草稿 Agent 数、已发布版本数和依赖项名称。
- 影响面响应与页面不展示 `apiKey`。

## 验收方式

### 1. 后端影响面 API

接口：

```text
GET /api/workspaces/{workspaceId}/model-providers/{providerId}/impact
```

覆盖测试：

```text
apps/api/tests/test_model_providers_api.py::test_model_provider_impact_lists_bound_drafts_and_published_versions
```

验收点：

- `draftAgents` 来自当前 Agent 草稿的 `modelProviderId`。
- `publishedVersions` 来自 AgentVersion 快照中的 `modelProviderId`。
- `totals.draftAgents` 和 `totals.publishedVersions` 与列表数量一致。
- 响应不包含 `apiKey`。

### 2. 前端页面展示

覆盖测试：

```text
src/pages/ModelProviders.test.tsx > shows Provider impact for draft Agents and published versions
```

验收点：

- Provider 卡片展示“草稿 Agent 1”。
- Provider 卡片展示“已发布版本 1”。
- Provider 卡片展示依赖 Agent 名称和版本。
- 页面不展示 `apiKey`。

### 3. 浏览器验收

浏览器验收结果：

```json
{
  "pageLoaded": true,
  "draftMetricVisible": true,
  "publishedMetricVisible": true,
  "noApiKeyText": true,
  "consoleWarnOrErrorCount": 0
}
```

证据：

- 截图：`.scratch/v0.15b-provider-impact.png`
- 结果：`.scratch/v0.15b-browser-result.json`

## 自动化验证

本版完成后执行了以下检查：

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_model_providers_api.py::test_model_provider_impact_lists_bound_drafts_and_published_versions -q
npx vitest run src/api/modelProviders.test.ts src/pages/ModelProviders.test.tsx --reporter verbose
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_model_providers_api.py apps/api/tests/test_agents_api.py apps/api/tests/test_execution_api.py -q
$files = rg --files src | Where-Object { $_ -match '\.test\.(ts|tsx)$' }; npx vitest run @($files) --reporter verbose
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q
npm run lint
npm run build
```

结果：

- 后端 focused：1 项通过。
- 前端 focused：2 个测试文件、7 项通过。
- 相关后端回归：29 项通过。
- 前端全量：29 个测试文件、115 项通过。
- 后端全量：通过。
- Lint：通过。
- Build：通过，保留既有 Vite chunk size warning。

## 尚未包含

- Provider 批量迁移。
- Provider 废止前的强制审批。
- Provider 快照差异可视化。
