# V0.26G 验收记录：Artifact Schema 校验状态筛选

## 范围

- Artifact 目录 API 支持 `schemaValidationStatus` 查询参数。
- `schemaValidationStatus` 可以和 `dataObjectDefinitionId` 组合使用。
- 前端 Artifact 实例页新增 Schema 校验状态筛选控件。
- 点击筛选后请求 URL 包含 `schemaValidationStatus`。
- 现有 Artifact 列表、详情和 Schema 状态展示不回退。

## 验收结果

- 后端 RED：`schemaValidationStatus=failed` 仍返回通过和失败两条 Artifact，断言 `len == 1` 失败。
- 前端 RED：页面测试找不到“Schema 校验状态”控件。
- 后端 GREEN：API 增加查询参数、派生状态过滤和过滤后 limit 后，后端聚焦测试通过。
- 前端 GREEN：API client 增加参数、页面增加状态下拉后，前端聚焦测试通过。
- Artifact API + 页面测试：`5 passed`。
- 后端执行链路回归：`39 passed`。
- 前端相关回归：`11 passed`。
- `npm run lint`：通过。
- `npm run build`：通过；保留既有 Vite 大 chunk 警告。
- 浏览器验证：Playwright 打开 `/w/ai-capability-center/artifacts`，选择“失败”筛选，确认请求后只显示失败 Artifact，并可打开详情查看失败原因；截图见 `.scratch/v0.26c-artifact-catalog-ui/browser-artifacts.png`。

## 验证命令

```powershell
cd apps/api
.\.venv\Scripts\python.exe -m pytest tests/test_execution_api.py -k artifact_catalog
.\.venv\Scripts\python.exe -m pytest tests/test_execution_api.py

cd ..\..
npm run test -- src/pages/Artifacts.test.tsx -t "renders artifact instances" --run
npm run test -- src/api/artifacts.test.ts src/pages/Artifacts.test.tsx --run
npm run test -- src/api/artifacts.test.ts src/pages/Artifacts.test.tsx src/components/Layout.test.tsx --run
npm run lint
npm run build
$env:ARC_ONE_PORT='4201'; python C:\Users\a\.codex\skills\webapp-testing\scripts\with_server.py --server "npm run dev -- --host 127.0.0.1 --port 4201" --port 4201 -- node .scratch\v0.26c-artifact-catalog-ui\browser-check.mjs
```

## 覆盖场景

- 后端按 `schemaValidationStatus=failed` 返回失败 Artifact。
- 后端组合使用 `dataObjectDefinitionId` 和 `schemaValidationStatus`。
- 前端筛选控件能选择失败状态。
- 前端请求包含 `schemaValidationStatus=failed`。

## 尚未覆盖

- 不持久化 Schema 校验状态。
- 不新增分页游标。
- 不支持多选状态或高级查询表达式。
