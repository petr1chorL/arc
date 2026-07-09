# V0.13F 验收说明：执行队列主动取消

> 日期：2026-06-27

## 本版完成内容

V0.13F 给执行队列补齐第一版主动取消能力。

- 新增 `POST /execution-jobs/{jobId}/cancel`。
- `queued`、`running`、`dead_letter` 任务可取消。
- 取消后 job 状态变为 `canceled`，记录 `canceledAt`，清理锁、heartbeat 和下一次尝试时间。
- 关联 Run 回到 `已取消`，当前节点显示 `已取消`，不会再被 worker 领取。
- 前端新增 `cancelExecutionJob` API client。
- 运行观测页队列卡片展示“取消任务”按钮，并新增 `已取消` 指标。

## 没有完成的内容

- 真正中断正在同一请求内执行的模型调用。
- 取消原因填写。
- 取消操作审计事件。
- 批量取消。

## 自动化验收

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_execution_api.py::test_execution_job_can_be_canceled_before_worker_claims_it -q
npm test -- --run src/api/execution.test.ts src/pages/Observability.test.tsx
```

预期结果：

- 后端 1 项通过。
- 前端 2 个测试文件、11 项通过。
- 覆盖队列任务取消、Run 状态回写、worker 不再领取已取消任务、前端 API 调用和观测页按钮。

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q
npm test -- --run
npm run lint
npm run build
```

预期结果：

- 后端 179 项通过。
- 前端 27 个测试文件、101 项测试通过。
- Oxlint 通过。
- TypeScript 编译与 Vite 生产构建通过。
