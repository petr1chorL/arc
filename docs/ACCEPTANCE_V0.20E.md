# V0.20E 批量失败点恢复验收

## 范围

V0.20E 在 V0.20B 的单条失败点恢复能力上，补齐运行中心的批量恢复操作。用户可以选择多条存在失败节点的 Workflow Run，一次从各自最近失败节点继续执行。成功项更新原 Run，失败项进入 `failures`，单条失败不阻断其他条目。

## 已实现

- 后端新增 `POST /api/workspaces/{workspaceId}/runs/batch-resume-from-failed-node`。
- 请求体为 `{ "runIds": string[] }`，最多 20 条，拒绝空 ID 和重复 ID。
- 接口逐条处理 Run，返回 `resumedRuns` 与 `failures`。
- 成功恢复项复用原 Run，不创建新 Run。
- 成功项写入 `run.batch_resume_failed_node` 审计事件。
- 前端 `src/api/execution.ts` 新增 `batchResumeRunsFromFailedNode`。
- Runs 页面批量选择条新增“批量恢复”按钮。
- 批量恢复成功后，页面更新原 Run、选中第一条成功恢复 Run，并展示“已批量恢复 N 条”提示。

## 验收标准

- [x] `POST /runs/batch-resume-from-failed-node` 可对多条失败 Workflow Run 恢复原 Run。
- [x] 响应包含 `resumedRuns` 和 `failures`。
- [x] 单条无失败节点、非 Workflow Run 或上下文缺失不会阻断其他合法 Run。
- [x] 成功项写入 `run.batch_resume_failed_node` 审计事件。
- [x] 前端 API wrapper 发送 `{ runIds }` 到批量恢复接口。
- [x] Runs 页面可勾选多条可恢复 Run 并点击“批量恢复”。
- [x] 批量恢复成功后更新原 Run 状态，选中第一条恢复成功 Run，并展示操作结果提示。
- [x] 浏览器验收中两条 V0.20E fixture Run 均恢复为已完成，console error 为 0。

## 验证证据

- RED 后端：focused 后端测试首次失败，接口返回 `405`。
- GREEN 后端：`apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_execution_api.py::test_workflow_runs_can_batch_resume_from_failed_nodes_with_per_item_failures -q` 通过。
- RED 前端 API：focused API 测试首次失败，`batchResumeRunsFromFailedNode is not a function`。
- GREEN 前端 API：`npx vitest run src/api/execution.test.ts --reporter verbose --pool=forks --fileParallelism=false --testTimeout 15000` 通过，11 项测试通过。
- RED Runs 页面：focused 页面测试首次失败，找不到“批量恢复”按钮。
- GREEN Runs 页面：`npx vitest run src/pages/Runs.test.tsx --reporter verbose --pool=forks --fileParallelism=false --testTimeout 15000` 通过，7 项测试通过。
- Focused 组合：`npx vitest run src/api/execution.test.ts src/pages/Runs.test.tsx --reporter verbose --pool=forks --fileParallelism=false --testTimeout 15000` 通过，2 个文件、18 项测试通过。
- 后端全量：`apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q` 通过，耗时 324.7 秒；仅有既有 Starlette/httpx deprecation warning。
- 前端全量：`npx vitest run --pool=forks --fileParallelism=false --testTimeout 15000` 通过，33 个文件、144 项测试通过；保留既有 `--localstorage-file` warning。
- 静态检查：`npm run lint` 通过。
- 生产构建：`npm run build` 通过；保留既有 Vite chunk size warning。
- 浏览器验收：在 `http://127.0.0.1:4173/w/ai-capability-center/runs` 中勾选两条 `V0.20E Browser Batch Resume` 失败 Run，点击“批量恢复”后页面展示“已批量恢复 2 条”，两条 Run 均变为“已完成”，A/B 详情产出分别回填为对应输入。
- 浏览器控制台：error log 数量为 0。
- 截图：`.scratch/v0.20e-batch-resume/browser-acceptance.png`。

## 未实现

- 不支持批量指定恢复节点。
- 不支持后台异步批量任务。
- 不支持跨 Workspace 批量恢复。
- 不做失败项自动重试队列。
