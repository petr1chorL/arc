# V0.26F 验收记录：Artifact Schema API 校验状态

## 范围

- Artifact 目录 API 返回 `schemaValidation` 派生字段。
- 合法 Artifact 返回 `passed`、中文标签和空原因列表。
- 缺少 required 字段的 Artifact 返回 `failed` 和失败原因。
- 前端类型支持可选 `schemaValidation`。
- Artifact 实例页优先使用 API 返回的校验结果，旧响应继续 fallback 到本地校验。

## 验收结果

- 后端 RED：`python -m pytest tests/test_execution_api.py -k artifact_catalog` 使用系统 Python 失败于缺少后端依赖；改用 `apps/api/.venv` 后，测试失败于 `KeyError: 'schemaValidation'`，确认 API 字段缺失。
- 后端 GREEN：新增 `validate_artifact_schema` helper、响应模型字段和 `/artifacts` 装配后，后端聚焦测试通过。
- 前端 RED：API fixture 返回 `schemaValidation.status == "passed"` 但内容缺 required 字段时，页面仍显示本地 `failed`。
- 前端 GREEN：页面改为优先使用 API 字段后，聚焦测试通过。
- 后端聚焦测试：`1 passed, 38 deselected`。
- 前端 Artifact 相关测试：`5 passed`。
- 后端执行链路回归：`39 passed`。
- 前端相关回归：`11 passed`。
- `npm run lint`：通过。
- `npm run build`：通过；保留既有 Vite 大 chunk 警告。
- 浏览器验证：Playwright 打开 `/w/ai-capability-center/artifacts`，模拟 API 返回 `schemaValidation`，确认列表显示通过/失败状态，详情弹窗展示“缺少必填字段：summary”；截图见 `.scratch/v0.26c-artifact-catalog-ui/browser-artifacts.png`。

## 验证命令

```powershell
cd apps/api
.\.venv\Scripts\python.exe -m pytest tests/test_execution_api.py -k artifact_catalog
.\.venv\Scripts\python.exe -m pytest tests/test_execution_api.py

cd ..\..
npm run test -- src/pages/Artifacts.test.tsx -t "prefers schema validation" --run
npm run test -- src/api/artifacts.test.ts src/pages/Artifacts.test.tsx --run
npm run test -- src/api/artifacts.test.ts src/pages/Artifacts.test.tsx src/components/Layout.test.tsx --run
npm run lint
npm run build
$env:ARC_ONE_PORT='4201'; python C:\Users\a\.codex\skills\webapp-testing\scripts\with_server.py --server "npm run dev -- --host 127.0.0.1 --port 4201" --port 4201 -- node .scratch\v0.26c-artifact-catalog-ui\browser-check.mjs
```

## 覆盖场景

- API 返回合法 Artifact 的通过状态。
- API 返回缺少 `summary` 的失败状态和“缺少必填字段：summary”。
- 页面优先展示 API 返回的校验状态。
- 页面在旧响应缺少 `schemaValidation` 时仍保留 V0.26E fallback。

## 尚未覆盖

- 不持久化校验结果。
- 不新增独立校验接口。
- 不实现完整 JSON Schema 引擎。
- 不做修复建议、告警或审计事件。
