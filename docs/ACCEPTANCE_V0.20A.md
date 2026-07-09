# V0.20A 历史 Workflow Run 重新运行验收

## 范围

V0.20A 为运行中心补充历史 Workflow Run 重新运行能力。运营人员可以在失败、已取消或恢复失败的 Workflow Run 详情中点击“重新运行”，平台会复用源 Run 的 Workflow、Workflow Version 和输入创建一条新的 Run，并留下审计记录。

## 已实现

- 后端新增 `POST /api/workspaces/{workspaceId}/runs/{runId}/rerun`。
- 只允许 `kind=workflow` 且包含 `workflowId`、`workflowVersion` 的 Run 重新运行。
- 新 Run 复用源 Run 的 `input`、`workflowId` 和 `workflowVersion`。
- 重新运行继续使用 `run.execute` 权限控制。
- 后端写入 `run.rerun` 审计事件，metadata 包含 `sourceRunId`、`newRunId`、`workflowId` 和 `workflowVersion`。
- 前端新增 `rerunWorkflowRun(workspaceId, runId)` API。
- Runs 页面在可重跑的 Workflow Run 上展示“重新运行”按钮。
- 点击成功后 Runs 页面将新 Run 插入列表、选中新 Run，并展示“重新运行已创建”提示。

## 验收标准

- [x] `POST /runs/{runId}/rerun` 对 workflow run 创建新的 Run。
- [x] 新 Run 复用源 Run 的 input、workflowId 和 workflowVersion。
- [x] 后端写入 `run.rerun` 审计事件，包含 sourceRunId 和 newRunId。
- [x] 非 workflow run 不能通过该接口重新运行。
- [x] Runs 页面在失败、已取消或恢复失败的 workflow run 上展示“重新运行”。
- [x] 重新运行成功后页面选中新 Run，并展示成功提示。

## 验证证据

- RED 后端：`apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_execution_api.py::test_failed_workflow_run_can_be_rerun_with_original_input_and_version -q` 首次失败，接口返回 404。
- RED 前端：`npx vitest run src/api/execution.test.ts src/pages/Runs.test.tsx --reporter verbose --pool=forks --fileParallelism=false --testTimeout 15000` 首次失败，缺少 `rerunWorkflowRun` 和“重新运行”按钮。
- Focused 后端：`apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_execution_api.py::test_failed_workflow_run_can_be_rerun_with_original_input_and_version apps/api/tests/test_execution_api.py::test_agent_run_cannot_be_rerun_from_workflow_history_endpoint -q`，2 项通过。
- Focused 前端：`npx vitest run src/api/execution.test.ts src/pages/Runs.test.tsx --reporter verbose --pool=forks --fileParallelism=false --testTimeout 15000`，2 个文件 10 项通过。
- 后端全量：`apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q`，210 项通过，保留既有 StarletteDeprecationWarning。
- 前端全量：`npx vitest run --pool=forks --fileParallelism=false --testTimeout 15000`，33 个文件 136 项通过，保留既有 `--localstorage-file` warning。
- `npm run lint` 通过。
- `npm run build` 通过，保留既有 Vite chunk-size warning。
- 浏览器验收：本地登录后在 Runs 页面构造失败 Workflow Run，确认“重新运行”按钮唯一可见；点击后出现“重新运行已创建”，页面保持在运行中心并选中新 Run；console warning/error 为 0。
- 截图：`.scratch/v0.20a-run-rerun.png`。

## 未实现

- 不支持编辑输入后再重新运行。
- 不支持批量重新运行。
- 不支持从失败节点恢复，本版本只从源 Workflow Version 的入口重新执行。
- 不支持 Agent test run 重新运行。
