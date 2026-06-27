# V0.13G 验收说明：常驻 Worker 骨架

> 日期：2026-06-27

## 本版完成内容

V0.13G 给异步执行队列补齐第一版后台 worker 代码骨架。

- 新增 `app.worker.ExecutionQueueWorker`。
- 支持 `process_once()`：按 Workspace 领取并处理一次队列任务。
- 支持 `process_until_idle()`：循环处理直到没有可领取任务。
- 支持 `run_forever()`：常驻轮询，没有任务时按间隔 sleep。
- Worker 使用已有 `ExecutionService.process_next_execution_job`，继承租约、重试、死信、取消语义。
- FastAPI app state 暴露 `execution_service`，便于 worker 复用同一执行服务。

## 没有完成的内容

- 操作系统级服务、Docker Compose worker 服务或进程守护。
- worker 启停管理页面。
- 多 worker 行级锁。
- worker 指标、日志和健康检查。

## 自动化验收

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_execution_worker.py -q
```

预期结果：

- 1 项通过。
- 覆盖 worker 处理 queued workflow run、写入 worker id、运行完成和队列空闲退出。

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q
npm test -- --run
npm run lint
npm run build
```

预期结果：

- 后端 180 项通过。
- 前端 27 个测试文件、101 项测试通过。
- Oxlint 通过。
- TypeScript 编译与 Vite 生产构建通过。
