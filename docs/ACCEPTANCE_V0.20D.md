# V0.20D 批量重跑验收

## 范围

V0.20D 在 V0.20A/C 的单条重跑能力上，补充运行中心批量重跑。用户可以选择多条可重跑
Workflow Run，一次性按各自原始输入重新运行。批量接口按条目返回成功创建的新 Run 和失败原因，
单条失败不阻断其他条目。

## 已实现

- 后端新增 `POST /api/workspaces/{workspaceId}/runs/batch-rerun`。
- 请求体为 `{ "runIds": string[] }`，最多 20 条，拒绝空 ID 和重复 ID。
- 合法 Workflow Run 使用自己的 Workflow、Workflow Version 和原始输入创建新 Run。
- 不存在、非 Workflow Run 或缺少版本上下文的条目进入 `failures`。
- 每条成功项写入 `run.batch_rerun` 审计事件。
- 前端 `batchRerunWorkflowRuns(workspaceId, runIds)` 调用批量接口。
- Runs 页面在可重跑 Run 行展示复选框，选中后展示批量操作条。
- 点击“批量重跑”后插入新 Run，选中第一条新 Run，并展示成功提示。

## 验收标准

- [x] `POST /runs/batch-rerun` 可对多条 workflow run 创建新 Run。
- [x] 响应区分 `createdRuns` 和 `failures`。
- [x] 单条不可重跑不会阻断其他合法 Run。
- [x] 每条成功项写入 `run.batch_rerun` 审计事件。
- [x] 前端 API wrapper 发送 `{ runIds }`。
- [x] Runs 页面可勾选多条可重跑 Run。
- [x] 点击“批量重跑”后插入新 Run、选中第一条新 Run、展示成功提示。
- [x] 浏览器验收中新 Run 的最终产出等于源 Run 原始输入。

## 验证证据

- RED 后端：focused 后端测试首次失败，接口返回 `405`。
- GREEN 后端：focused 后端测试通过。
- RED 前端 API：focused API 测试首次失败，`batchRerunWorkflowRuns is not a function`。
- GREEN 前端 API：focused API 测试通过，10 项测试通过。
- RED Runs 页面：focused 页面测试首次失败，找不到批量选择 checkbox。
- GREEN Runs 页面：focused 页面测试通过，6 项测试通过。
- Focused 后端：
  `apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_execution_api.py::test_workflow_runs_can_be_batch_rerun_with_per_item_failures -q`
  通过。
- Focused 前端：
  `npx vitest run src/api/execution.test.ts src/pages/Runs.test.tsx --reporter verbose --pool=forks --fileParallelism=false --testTimeout 15000`
  通过，2 个文件、16 项测试通过。
- 静态检查：
  `npm run lint` 通过。
- 生产构建：
  `npm run build` 通过；保留既有 Vite chunk size warning。
- 后端全量：
  `apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q`
  通过，耗时 313.7 秒；仅有既有 Starlette/httpx deprecation warning。
- 前端全量：
  `npx vitest run --pool=forks --fileParallelism=false --testTimeout 15000`
  通过，33 个文件、142 项测试通过；保留既有 `--localstorage-file` warning。
- 浏览器验收：
  `http://127.0.0.1:4173/w/ai-capability-center/runs`
  中选择两条 `V0.20D Batch Rerun Acceptance Flow` 失败 Run，点击“批量重跑”后新建 2 条完成 Run；
  页面展示“已批量重跑 2 条”，选中第一条新 Run，最终产出为
  `Batch V0.20D browser input A`。
- 浏览器控制台：
  error log 数量为 0。
- 截图：
  `.scratch/v0.20d-batch-rerun/browser-acceptance.png`。

## 未实现

- 不支持批量编辑输入。
- 不支持异步批量任务。
- 不支持批量失败点恢复。
- 不支持跨 Workspace 批量重跑。
