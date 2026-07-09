# V0.13B 验收说明：异步队列失败重试与死信

> 日期：2026-06-27

## 本版完成内容

V0.13B 在 V0.13A 的 `execution_jobs` 队列骨架上补齐第一版失败处理语义。

- `execution_jobs` 新增 `max_attempts`、`next_attempt_at` 和 `dead_lettered_at`。
- Worker 领取任务后，如果工作流运行失败且未达到最大尝试次数，会把 job 重新置为 `queued`。
- 重新入队时 Run 状态回到 `排队中`，当前节点显示为 `等待重试`，错误原因保留。
- 再次领取同一 job 后可以继续执行，成功后 job 变为 `succeeded`。
- 达到最大尝试次数后，job 进入 `dead_letter`，Run 保持 `失败`，并记录最终错误。

## 没有完成的内容

- 指数退避时间窗口，目前 `next_attempt_at` 为立即可重试。
- 常驻后台 worker 进程。
- 多 worker 并发锁、租约和心跳。
- 死信队列前端运营页。
- 人工触发的 Run 级重试入口。

## 自动化验收

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_execution_api.py::test_async_execution_job_retries_failure_before_dead_letter apps/api/tests/test_execution_api.py::test_async_execution_job_moves_to_dead_letter_after_max_attempts -q
```

预期结果：

- 2 项通过。
- 覆盖失败后重新入队、第二次领取后成功，以及 3 次失败后进入 `dead_letter`。

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_execution_api.py apps/api/tests/test_human_workflow_execution.py apps/api/tests/test_human_task_api.py apps/api/tests/test_observability_api.py -q
```

预期结果：

- 44 项通过。
- 覆盖同步执行、异步队列、人工审核、恢复执行和观测中心回归。

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q
npm test -- --run
npm run lint
npm run build
```

预期结果：

- 后端 174 项通过。
- 前端 27 个测试文件、98 项测试通过。
- Oxlint 通过。
- TypeScript 编译与 Vite 生产构建通过。
