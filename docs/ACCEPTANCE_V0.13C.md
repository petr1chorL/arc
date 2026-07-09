# V0.13C 验收说明：Worker 租约与心跳

> 日期：2026-06-27

## 本版完成内容

V0.13C 在异步队列上补齐第一版 worker 租约语义，避免多个 worker 同时处理同一条任务。

- `execution_jobs` 新增 `locked_by`、`locked_until` 和 `last_heartbeat_at`。
- `POST /execution-jobs/next?workerId=...` 领取任务时写入 worker 标识和 5 分钟租约。
- 租约未过期的 `running` job 不会被其他 worker 领取。
- 租约过期的 `running` job 可被新的 worker 接管并继续执行。
- 新增 `POST /execution-jobs/{jobId}/heartbeat?workerId=...`，当前租约持有者可延长租约。

## 没有完成的内容

- 常驻后台 worker 进程。
- 真正的并发数据库行级锁。
- 指数退避。
- 死信队列和租约状态前端运营页。
- 实时事件推送。

## 自动化验收

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_execution_api.py::test_execution_job_lease_blocks_claim_until_expired apps/api/tests/test_execution_api.py::test_execution_job_heartbeat_extends_active_lease -q
```

预期结果：

- 2 项通过。
- 覆盖租约未过期时拒绝其他 worker 领取、租约过期后可接管，以及 heartbeat 延长租约。

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_execution_api.py apps/api/tests/test_human_workflow_execution.py apps/api/tests/test_human_task_api.py apps/api/tests/test_observability_api.py -q
```

预期结果：

- 46 项通过。
- 覆盖同步执行、异步队列、失败重试、租约接管、人工审核、恢复执行和观测中心回归。

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q
npm test -- --run
npm run lint
npm run build
```

预期结果：

- 后端 176 项通过。
- 前端 27 个测试文件、98 项测试通过。
- Oxlint 通过。
- TypeScript 编译与 Vite 生产构建通过。
