# V0.13J 验收说明：队列失败指数退避

> 日期：2026-06-27

## 本版完成内容

V0.13J 给异步执行队列补齐第一版失败重试退避策略。

- worker 处理失败后，job 仍回到 `queued`。
- `next_attempt_at` 不再立即等于当前时间，而是写入未来时间。
- 退避时间到达前，其他 worker 领取下一条任务会返回 404。
- 退避策略为 30s、60s、120s 递增，最大 15 分钟。
- 已保留 `max_attempts` 到达后进入 `dead_letter` 的语义。

## 没有完成的内容

- 可配置退避参数。
- 带抖动 jitter 的退避。
- 前端展示“下次可重试倒计时”。
- 真正的数据库行级并发锁。

## 自动化验收

### RED/GREEN 验证

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_execution_api.py::test_async_execution_job_retry_uses_future_backoff_before_next_claim -q
```

RED 结果：

- 首次失败，因为 `next_attempt_at` 仍为当前时间。

GREEN 结果：

- 测试通过。
- 覆盖失败后 job 重新排队、`next_attempt_at` 位于未来、退避未到期时 worker 不能再次领取。

### Focused 回归

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_execution_api.py -q
```

实际结果：

- 16 项通过。
- 覆盖同步工作流重试、异步队列重试、死信、租约、heartbeat、重投和取消。

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
