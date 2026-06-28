# V0.21B Run 操作历史跳转审计日志验收

V0.21B 在 V0.21A 的 Run 操作历史基础上补齐审计追踪入口。用户在运行中心选中一条 Run 后，可以从每条操作历史直接跳转到对应 Trace ID 的审计日志过滤结果。

## 范围

- Run 操作历史接口返回审计事件的 `traceId`。
- Runs 页面在操作历史条目上展示“查看审计”入口。
- 点击入口后跳转到当前 Workspace 的审计日志页面，并带上 `traceId` 查询参数。
- 审计日志页面继续复用已有 Trace ID 过滤能力。

## 验收清单

- [x] 后端 `GET /api/workspaces/{workspaceId}/runs/{runId}/operation-history` 返回 `traceId`。
- [x] 前端 `RunOperationHistoryEvent` 类型包含 `traceId`。
- [x] Runs 页面操作历史条目展示“查看审计”链接。
- [x] 链接地址为 `/w/{workspaceSlug}/settings/audit?traceId={traceId}`。
- [x] 没有操作历史时仍展示空态，不影响 Run 主详情。

## 自动化验证

- `apps\api\.venv\Scripts\python.exe -m pytest apps/api/tests/test_execution_api.py -q -k operation_history`
  - 结果：通过。
- `npx vitest run src/pages/Runs.test.tsx src/api/execution.test.ts --reporter verbose --pool=forks --fileParallelism=false --testTimeout 15000`
  - 结果：通过，2 个测试文件、22 个测试通过。

## 浏览器验证

- 页面：`http://127.0.0.1:4173/w/ai-capability-center/runs`
- 验收数据：`V0.21A Browser Operation History 7f3c2a`
- 操作：选中 Run 后点击“查看审计”。
- 结果：跳转到 `/w/ai-capability-center/settings/audit?traceId=trace-40e6e658-e117-4d8f-8081-5d4c891e6ff5`。
- 页面显示：当前 Trace 过滤、`run.batch_rerun`、`req-v021a-browser`。
- 控制台错误：0。
- 截图：`.scratch/v0.21b-run-operation-audit-link/browser-acceptance.png`

## 非目标

- 不新增审计日志查询 API。
- 不改变审计日志页面的过滤语义。
- 不把操作历史改成独立数据表；事实来源仍是 Workspace 审计事件。
