# V0.29B 验收记录：修复任务详情 API 与深链直读

## 范围

V0.29B 增加 Remediation Task 单条详情读取能力，并让评估中心的 `taskId` 深链不再依赖当前列表一定包含目标任务。

## 已实现

- 新增 `GET /api/workspaces/{workspaceId}/evaluations/remediation-tasks/{taskId}`。
- 单条接口返回 `activities`、`retestRun`、`retestSummary` 和 `isOverdue`。
- 不存在或跨 Workspace 的任务返回 404。
- 前端 API 新增 `getRemediationTask(workspaceId, taskId)`。
- 评估中心在当前列表不含目标 `taskId` 时，会读取单条任务详情并合并到本地任务列表。
- 单条任务加载中展示“正在加载定位任务”，不会提前显示“未找到定位任务”。

## 范围外

- 不新增独立 Remediation Task 详情页。
- 不新增分页、搜索、高级筛选或批量读取。
- 不新增数据库字段和迁移。
- 不改变 Remediation Task 状态机、复测回流和去重规则。

## TDD 证据

- RED：`apps\api\.venv\Scripts\python.exe -m pytest apps/api/tests/test_evaluations_api.py::test_remediation_task_detail_can_be_read_by_id -q`
  - 结果：失败，`GET /evaluations/remediation-tasks/{taskId}` 返回 `405 Method Not Allowed`。
- GREEN：同一后端聚焦测试通过。
- RED：`npm run test -- --run src/pages/Evaluations.test.tsx -t "loads a deep-linked remediation task detail when the filtered list does not include it"`
  - 结果：失败，页面找不到 `修复任务详情 remediation-task-1`。
- GREEN：同一前端聚焦测试通过。

## 最终验证

- `apps\api\.venv\Scripts\python.exe -m pytest apps/api/tests/test_evaluations_api.py -q`
  - 结果：16 passed。
- `npm run test -- --run --no-file-parallelism src/pages/Evaluations.test.tsx src/pages/Artifacts.test.tsx src/pages/Observability.test.tsx src/api/artifacts.test.ts src/components/Layout.test.tsx`
  - 结果：5 files passed，51 tests passed。
- `npm run lint`
  - 结果：通过。
- `npm run build`
  - 结果：通过；保留既有 Vite chunk size warning。
- `git diff --check`
  - 结果：通过；仅提示工作区 LF/CRLF 转换 warning。
- 浏览器验收：
  - 命令：`apps\api\.venv\Scripts\python.exe C:\Users\a\.codex\skills\webapp-testing\scripts\with_server.py --server "npm run dev -- --host 127.0.0.1 --port 4202" --port 4202 --timeout 60 -- node .scratch\v0.29b-remediation-task-detail-api\browser-check.mjs`
  - 结果：通过。已验证登录态下访问 `/w/ai-capability-center/evaluations?taskId=remediation-task-1` 时，列表不含目标任务也能加载“修复任务详情 remediation-task-1”，列表保留 `remediation-task-2`，页面无 console error。

