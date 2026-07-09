# V0.20B 失败节点恢复验收

## 范围

V0.20B 为运行中心补充“从失败点恢复”能力。它和 V0.20A 的“重新运行”不同：重新运行会创建一条新的 Workflow Run，并从工作流入口重新执行；失败点恢复会复用原 Run，从最近失败的节点重新执行，并追加新的节点运行记录。

## 已实现

- 后端新增 `POST /api/workspaces/{workspaceId}/runs/{runId}/resume-from-failed-node`。
- 仅支持 `kind=workflow` 且具备 `workflowId`、`workflowVersion` 的 Run。
- 如果当前 Run 没有失败节点，接口返回 `409`。
- 恢复时定位最近失败的 `NodeRunRecord`，复用原 Workflow Version 快照。
- 恢复执行复用前序成功节点的输出，并从失败节点继续往后执行。
- 恢复成功后保留原 Run ID，不创建新 Run。
- 节点时间线保留旧的失败节点，并追加新的恢复节点与后续节点。
- 后端写入 `run.resume_failed_node` 审计事件，metadata 包含 `runId`、`failedNodeRunId`、`failedNodeId` 和 `workflowVersion`。
- 前端新增 `resumeRunFromFailedNode(workspaceId, runId)` API。
- Runs 页面在失败的 Workflow Run 上展示“从失败点恢复”按钮。
- 点击成功后页面原地更新当前 Run，并展示“已从失败点恢复”提示。

## 验收标准

- [x] 失败的 Workflow Run 调用恢复接口后返回同一个 Run ID。
- [x] 恢复成功后 Run 状态变为完成，输出来自恢复后的节点。
- [x] 节点时间线包含旧失败节点和新增恢复节点。
- [x] 无失败节点的 Workflow Run 调用恢复接口返回 `409`。
- [x] 后端写入 `run.resume_failed_node` 审计事件。
- [x] 前端 API 调用路径正确。
- [x] Runs 页面失败工作流展示“从失败点恢复”按钮。
- [x] 点击成功后当前 Run 被更新，并显示成功提示。

## 验证证据

- RED 后端：`apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_execution_api.py::test_failed_workflow_run_can_resume_from_failed_node apps/api/tests/test_execution_api.py::test_completed_workflow_run_cannot_resume_without_failed_node -q` 首次失败，接口返回 `404`。
- RED 前端：`npx vitest run src/api/execution.test.ts src/pages/Runs.test.tsx --reporter verbose --pool=forks --fileParallelism=false --testTimeout 15000` 首次失败，缺少 `resumeRunFromFailedNode` 与“从失败点恢复”按钮。
- Focused 后端：`apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_execution_api.py::test_failed_workflow_run_can_resume_from_failed_node apps/api/tests/test_execution_api.py::test_completed_workflow_run_cannot_resume_without_failed_node -q`，2 项通过。
- Focused 前端：`npx vitest run src/api/execution.test.ts src/pages/Runs.test.tsx --reporter verbose --pool=forks --fileParallelism=false --testTimeout 15000`，2 个文件 12 项通过。
- 兼容验证：`apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_execution_api.py::test_failed_workflow_run_can_resume_from_failed_node apps/api/tests/test_execution_api.py::test_failed_workflow_run_with_unknown_status_and_error_can_resume apps/api/tests/test_execution_api.py::test_completed_workflow_run_cannot_resume_without_failed_node -q`，3 项通过。
- 后端全量：`apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q`，217 项通过，保留既有 `StarletteDeprecationWarning`。
- 前端全量：`npx vitest run --pool=forks --fileParallelism=false --testTimeout 15000`，33 个文件 138 项通过，保留既有 `--localstorage-file` warning。
- `npm run lint` 通过。
- `npm run build` 通过，保留既有 Vite chunk-size warning。
- 浏览器验收：在运行中心构造带失败 NodeRun 的 Workflow Run，点击“从失败点恢复”后，同一 Run 状态变为已完成，详情区不再显示恢复按钮，最终产出更新为恢复后的输出，旧失败节点仍在时间线中，新完成节点追加在后面，新增 console warning/error 为 0。
- 浏览器截图：`.scratch/v0.20b-resume-failed-node.png`。

## 未实现

- 不支持选择任意节点恢复，只恢复最近失败节点。
- 不支持编辑输入后再恢复。
- 不支持批量恢复多个 Run。
- 不支持 Agent test run 恢复。
- 不提供外部通知，恢复结果仅在当前页面和审计事件中记录。
