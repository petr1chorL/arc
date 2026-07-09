# V0.30A 验收记录：Notification Outbox 发送器第一切片

## 范围

V0.30A 为已有 `NotificationOutboxRecord` 增加后端 dispatch 能力。平台现在可以通过 Workspace API 消费一批 `pending` 通知，调用可注入发送端口，并把发送结果回写到通知记录。

## 已实现

- 新增 `app.notification_dispatcher` 模块：
  - `NotificationDelivery`
  - `NotificationDispatchResult`
  - `NotificationDispatcher`
  - `NoopNotificationDispatcher`
  - `NotificationOutboxDispatchService`
- 新增 `POST /api/workspaces/{workspace_id}/notifications/outbox/dispatch`。
- 只消费当前 Workspace 下 `status=pending` 的通知。
- 成功发送后状态更新为 `sent`。
- 失败发送后状态更新为 `failed`。
- `payload.dispatch` 记录 `status`、`providerMessageId`、`error` 和 `dispatchedAt`。
- 响应返回 `processed`、`sent`、`failed` 和逐条结果。
- 没有待发送通知时返回空结果。
- 测试可注入 Fake Dispatcher；默认实现为 Noop Dispatcher，不访问外部网络。

## 本版不包含

- 不接入真实飞书、邮件、Webhook 或其他外部 SDK。
- 不新增数据库字段。
- 不新增前端页面。
- 不实现后台定时消费。
- 不实现失败重试、退避或重新入队。
- 不实现通知模板编辑器或渠道配置页面。

## TDD 证据

RED：

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_notification_dispatcher_api.py -q
```

结果：失败，原因是 `create_app()` 尚不接受 `notification_dispatcher` 参数，dispatch API 还不存在。

GREEN：

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_notification_dispatcher_api.py -q
```

结果：2 个测试通过。

## 最终验证

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_notification_dispatcher_api.py apps/api/tests/test_observability_api.py apps/api/tests/test_human_task_api.py -q
```

结果：29 个后端测试通过。覆盖 V0.30A 新 dispatch API、V0.8F 观测告警 Outbox 和既有 Human Task SLA Outbox 生成链路。

```powershell
npm run lint
npm run build
git diff --check
```

结果：lint 通过，build 通过；Vite 保留既有 chunk size warning；`git diff --check` 未发现空白错误，仅提示 Windows LF/CRLF 行尾警告。
