# V0.30B 验收记录：Notification Outbox Worker 入口

## 范围

V0.30B 在 V0.30A dispatch API 之后，新增后端 Notification Outbox worker / CLI 入口，让通知 Outbox 可以通过命令行或 Compose 服务消费，而不必人工调用 HTTP API。

## 已实现

- 新增 `app.notification_worker` 模块：
  - `NotificationOutboxWorker`
  - `create_notification_outbox_worker`
  - `main(argv=None)`
- `NotificationOutboxWorker.process_once()` 会遍历 active Workspace，调用 `NotificationOutboxDispatchService.dispatch_pending` 并提交事务。
- `process_until_idle()` 会持续处理直到某轮没有 pending 通知。
- `python -m app.notification_worker --once` 可执行单轮消费，并打印 `processed=<n>`。
- `apps/api/pyproject.toml` 新增 console script：`arc-one-notification-worker`。
- `compose.yaml` 新增 `notification-worker` 服务，与 API 共用 PostgreSQL 配置。

## 本版不包含

- 不接入真实飞书、邮件、Webhook 或外部 SDK。
- 不新增通知渠道配置页面。
- 不实现失败重试、退避或重新入队。
- 不实现发送频率限制。
- 不新增前端页面。

## TDD 证据

RED：

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_notification_worker.py apps/api/tests/test_deploy_compose.py -q
```

结果：失败，原因是缺少 `app.notification_worker`。

GREEN：

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_notification_worker.py apps/api/tests/test_deploy_compose.py -q
```

结果：6 个测试通过。

## 最终验证

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_notification_worker.py apps/api/tests/test_notification_dispatcher_api.py apps/api/tests/test_deploy_compose.py -q
```

结果：8 个后端/部署配置测试通过。覆盖 V0.30B worker、V0.30A dispatch API 回归和 Compose 服务定义。

```powershell
npm run lint
npm run build
git diff --check
```

结果：lint 通过，build 通过；Vite 保留既有 chunk size warning；`git diff --check` 未发现空白错误，仅提示 Windows LF/CRLF 行尾警告。
