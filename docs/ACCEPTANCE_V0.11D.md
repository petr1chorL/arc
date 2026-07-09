# V0.11D 执行事件流验收记录

## 版本目标

在运行观测详情中提供统一执行事件流，让用户从一个 Trace 看到运行、节点、人工审核和审计事件的完整时间顺序；同时提供 Workspace 级事件查询，把修复任务和复测回流也纳入统一排障链路。

## 已实现能力

- `GET /observability/runs/{runId}` 返回 `executionEvents`。
- `GET /observability/execution-events` 支持按 `runId` 或 `traceId` 查询 Workspace 级执行事件。
- 事件流按 `occurredAt` 升序排列。
- 事件来源覆盖 `workflow_run`、`node_run`、`human_task` 和 `audit_event`。
- Workspace 级事件来源额外覆盖 `remediation_task`、`remediation_activity` 和 `regression_run`。
- 每条事件包含 `traceId`，能关联节点的事件包含 `spanId`。
- 前端运行观测详情新增“执行事件流”区块。
- 页面显示事件类型、来源、状态、时间、Trace 和 Span。

## 验收命令

- `apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_observability_api.py::test_observability_run_detail_includes_trace_context apps/api/tests/test_observability_api.py::test_workspace_execution_events_include_remediation_and_retest_events -q`：2 条通过。
- `npm test -- --run src/api/observability.test.ts src/pages/Observability.test.tsx`：2 个测试文件、11 条测试通过。
- `apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q`：全量通过。
- `npm test -- --run`：27 个测试文件、96 条测试通过。
- `npm run lint`：通过。
- `npm run build`：通过。

## 浏览器验收

- 页面：`http://127.0.0.1:4173/w/ai-capability-center/observability`
- 结果：运行详情显示“执行事件流”，可见 `workflow_run`、`node_run`、`human_task`、`audit_event`，并显示 Trace 与 Span。
- 新起点后的浏览器 console warning/error：0。
- 截图：`.scratch/v0.11d-execution-event-stream.png`
- 结果文件：`.scratch/v0.11d-browser-result.json`

## 已知非阻断警告

- Pytest 仍有既有 `StarletteDeprecationWarning`。
- Vitest 仍有既有 Node `--localstorage-file` warning。
- Vite build 仍有既有 chunk size warning。
