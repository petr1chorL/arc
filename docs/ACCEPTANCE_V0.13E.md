# V0.13E 验收说明：死信任务手动重新入队

> 日期：2026-06-27

## 本版完成内容

V0.13E 让执行队列运营卡片具备第一版处理动作。

- 新增 `POST /execution-jobs/{jobId}/requeue`。
- 仅允许 `dead_letter` 任务重新入队。
- 重新入队后 job 状态变为 `queued`，尝试次数清零，错误、锁、heartbeat 和死信时间清空。
- 关联 Run 回到 `排队中`，当前节点显示为 `等待重投`。
- 前端新增 `requeueExecutionJob` API client。
- 运行观测页的死信任务展示“重新入队”按钮，点击后调用接口并刷新队列。

## 没有完成的内容

- 批量重新入队。
- 重新入队原因填写。
- 操作审计事件。
- 更细的重投权限策略。

## 自动化验收

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_execution_api.py::test_dead_letter_execution_job_can_be_requeued -q
npm test -- --run src/api/execution.test.ts src/pages/Observability.test.tsx
```

预期结果：

- 后端 1 项通过。
- 前端 2 个测试文件、10 项测试通过。
- 覆盖 dead letter 重新入队、Run 状态回写、前端 API 调用和观测页按钮。

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q
npm test -- --run
npm run lint
npm run build
```

预期结果：

- 后端 178 项通过。
- 前端 27 个测试文件、100 项测试通过。
- Oxlint 通过。
- TypeScript 编译与 Vite 生产构建通过。
