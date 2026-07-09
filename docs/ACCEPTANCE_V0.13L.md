# V0.13L 验收说明：队列任务详情 API

> 日期：2026-06-27

## 本版完成内容

V0.13L 给执行队列补齐第一版单任务详情读取能力。

- 新增 `GET /execution-jobs/{jobId}`。
- 返回 `ExecutionJob` 完整运营字段。
- 返回关联 `AuditEventRecord`，包含 action、outcome、reason、before/after status、payload、actor、request ID 和创建时间。
- 前端新增 `ExecutionJobAuditEvent` 与 `ExecutionJobDetail` 类型。
- 前端新增 `getExecutionJob(workspaceId, jobId)` API wrapper。

## 没有完成的内容

- 独立队列运营详情页面。
- 队列任务详情中的 NodeRun / Run 时间线聚合。
- 队列任务排障建议。
- 批量队列运营。

## 自动化验收

### RED/GREEN 验证

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_execution_api.py::test_execution_job_detail_includes_operation_audit_events -q
npm test -- --run src/api/execution.test.ts
```

RED 结果：

- 后端首次失败，因为 `GET /execution-jobs/{jobId}` 返回 404。
- 前端首次失败，因为 `getExecutionJob` 不存在。

GREEN 结果：

- 后端详情测试通过。
- 前端 execution API 测试 6 项通过。

### Focused 回归

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_execution_api.py -q
npm test -- --run src/api/execution.test.ts
```

实际结果：

- 后端执行 API 17 项通过。
- 前端 execution API 1 个测试文件、6 项通过。

### 全量回归

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q
npm test -- --run
npm run lint
npm run build
git diff --check
```

实际结果：

- 后端 185 项测试通过。
- 前端 27 个测试文件、102 项测试通过。
- `npm run lint` 通过。
- `npm run build` 通过。
- `git diff --check` 仅有 Windows 换行提示，没有 whitespace error。
