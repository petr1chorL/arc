# V0.13A 验收说明：异步任务队列第一切片

> 日期：2026-06-27

## 本版完成内容

V0.13A 第一切片把工作流执行从“只能同步执行”推进到“可选择入队，再由 worker 领取执行”的后端骨架。

- `RunCreate` 新增 `asyncMode`。
- `asyncMode=false` 时保持原同步执行行为不变。
- `asyncMode=true` 时创建 `WorkflowRunRecord`，状态为 `排队中`，不立即调用模型。
- 新增 `execution_jobs` 表，记录 run、workflow、version、输入、状态、尝试次数、错误和时间戳。
- 新增 `POST /execution-jobs/next`，用于领取当前 Workspace 下一条 queued job 并执行。
- Worker 执行完成后会更新 Run 节点时间线、输出和 job 状态。

## 没有完成的内容

- 常驻后台 worker 进程。
- 多 worker 并发锁、租约和心跳。
- 失败重试退避、最大重试次数和死信队列。
- 前端运行中心的队列状态操作入口。

## 自动化验收

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_execution_api.py::test_async_workflow_run_enqueues_and_worker_processes_next_job -q
```

预期结果：

- 1 项通过。
- 覆盖 asyncMode 入队、模型不立即调用、队列任务落库、worker 领取执行、Run 完成和 job 成功状态。

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_execution_api.py apps/api/tests/test_human_workflow_execution.py apps/api/tests/test_human_task_api.py apps/api/tests/test_observability_api.py -q
```

预期结果：

- 42 项通过。
- 覆盖同步执行、人工审核、恢复执行、观测中心和异步队列第一切片回归。

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q
npm test -- --run
npm run lint
npm run build
```

预期结果：

- 后端 172 项通过。
- 前端 27 个测试文件、98 项测试通过。
- Oxlint 通过。
- TypeScript 编译与 Vite 生产构建通过。
