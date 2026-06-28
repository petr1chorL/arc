# V0.20C 带输入覆盖的历史 Run 重新运行验收

## 范围

V0.20C 在 V0.20A 的历史 Workflow Run 重新运行能力上，增加可选输入覆盖。
用户可以继续按原输入重跑，也可以在运行中心展开输入编辑区，基于源 Run 的输入
修改后创建新的 Run。

## 已实现

- 后端 `POST /api/workspaces/{workspaceId}/runs/{runId}/rerun` 支持可选 JSON body。
- 不传 body 或不传 `input` 时，保持 V0.20A 行为，复用源 Run 输入。
- 传入 `{ "input": "..." }` 时，新 Run 使用覆盖输入。
- 覆盖输入会校验非空和最大长度。
- 审计事件 `run.rerun` 的 metadata 增加 `inputOverridden`。
- 前端 `rerunWorkflowRun(workspaceId, runId, { input })` 支持发送覆盖输入。
- Runs 页面新增“编辑输入重跑”入口。
- 输入编辑区默认填充源 Run 输入，支持取消和确认重跑。
- 确认成功后，新 Run 插入列表并被选中，页面展示“重新运行已创建”。

## 验收标准

- [x] 不传 body 调用 rerun 时继续复用源 Run 输入。
- [x] 传入覆盖输入时新 Run 使用覆盖输入。
- [x] 空白覆盖输入返回 `422`。
- [x] 审计事件包含 `inputOverridden=true`。
- [x] 前端 API 发送覆盖输入 JSON body。
- [x] Runs 页面能打开编辑区，并默认填充源 Run 输入。
- [x] 确认重跑成功后选中新 Run 并展示成功提示。
- [x] 浏览器验收中，新 Run 的最终产出等于覆盖输入。

## 验证证据

- RED 后端：V0.20C focused 后端测试首次失败，覆盖输入仍复用源输入，空白输入返回 `201`。
- RED 前端：V0.20C focused 前端测试首次失败，缺少编辑输入入口；API wrapper 不支持第三个参数。
- Focused 后端：
  `apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_execution_api.py::test_failed_workflow_run_can_be_rerun_with_overridden_input apps/api/tests/test_execution_api.py::test_workflow_rerun_rejects_blank_overridden_input -q`
  通过，2 项测试通过。
- 后端全量：
  `apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q`
  通过，耗时 310.5 秒；仅有既有 Starlette/httpx deprecation warning。
- Focused 前端：
  `npx vitest run src/api/execution.test.ts src/pages/Runs.test.tsx --reporter verbose --pool=forks --fileParallelism=false --testTimeout 15000`
  通过，2 个文件、14 项测试通过。
- 前端全量：
  `npx vitest run --pool=forks --fileParallelism=false --testTimeout 15000`
  通过，33 个文件、140 项测试通过；保留既有 `--localstorage-file` warning。
- 静态检查：
  `npm run lint` 通过。
- 生产构建：
  `npm run build` 通过；保留既有 Vite chunk size warning。
- 浏览器验收：
  `http://127.0.0.1:4173/w/ai-capability-center/runs`
  中使用 `V0.20C Input Override Acceptance Flow` 失败 Run，点击“编辑输入重跑”，
  输入框预填 `Original V0.20C browser input`，改为
  `Corrected V0.20C browser input` 后确认重跑；新 Run 状态为“已完成”，最终产出和
  Start/End 节点输出均为覆盖输入。
- 浏览器控制台：
  error log 数量为 0。
- 截图：
  `.scratch/v0.20c-rerun-with-input/browser-acceptance.png`。

## 未实现

- 不支持修改 Workflow Version。
- 不支持编辑节点中间产物后重跑。
- 不支持批量重跑。
- 不支持 Agent test run 重跑。
- 不支持异步重跑模式切换。
