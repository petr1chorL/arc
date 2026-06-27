# V0.13K 验收说明：队列运营动作审计

> 日期：2026-06-27

## 本版完成内容

V0.13K 给执行队列的人工运营动作补齐成功审计。

- `POST /execution-jobs/{jobId}/requeue` 支持可选 `reason` 请求体。
- `POST /execution-jobs/{jobId}/cancel` 支持可选 `reason` 请求体。
- 死信重投成功后写入 `execution_job.requeue` 审计事件。
- 队列取消成功后写入 `execution_job.cancel` 审计事件。
- 审计事件记录 Workspace、操作者、请求 ID、目标 job、前后状态、原因、Run ID、Workflow ID 和操作前后尝试次数。

## 没有完成的内容

- 前端弹窗收集取消/重投原因。
- 队列运营详情页展示审计时间线。
- 批量重投/批量取消。
- 失败操作的业务原因分类。

## 自动化验收

### RED/GREEN 验证

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_execution_api.py::test_dead_letter_execution_job_can_be_requeued apps/api/tests/test_execution_api.py::test_execution_job_can_be_canceled_before_worker_claims_it -q
```

RED 结果：

- 首次失败，因为重投和取消成功后没有对应 `AuditEventRecord`。

GREEN 结果：

- 2 项通过。
- 覆盖成功审计事件、原因、前后状态、Run 上下文和尝试次数快照。

### Focused 回归

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_execution_api.py -q
```

实际结果：

- 16 项通过。
- 覆盖同步执行、异步队列、重试、死信、租约、heartbeat、重投、取消和审计。

### 全量回归

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q
npm test -- --run
npm run lint
npm run build
git diff --check
```

实际结果：

- 后端 184 项测试通过。
- 前端 27 个测试文件、101 项测试通过。
- `npm run lint` 通过。
- `npm run build` 通过。
- `git diff --check` 仅有 Windows 换行提示，没有 whitespace error。
