# V0.30D 验收记录：Notification Channel Router

## 第一性原理

通知系统的底层目标是把“业务事件”可靠送到“目标收件人”。在真实飞书、邮件或 Webhook 接入前，必须先有一个明确的渠道边界：通知声明想走哪个渠道，平台把它交给对应 adapter，并把无法路由的原因记录为失败证据。

本版本选择先做本地 Channel Router，而不是直接接真实渠道，因为真实渠道还需要凭证托管、回调签名、限流、幂等、模板和退避策略。

## 对抗式审查

- 未知渠道不能静默回退到 `in_app`，否则会制造“似乎已经送达”的错误完成感。
- 禁用渠道不能调用 adapter，避免后续停用渠道后仍然外发。
- 未知或禁用渠道不能让 Worker 崩溃，应变成结构化失败并进入 Outbox 证据链。
- 默认实现不能访问真实外部网络。
- 文档不能把本地 router 误写成真实飞书/邮件/Webhook 通知能力。

## 已实现

- 新增 `NotificationChannelAdapter(name, dispatcher, enabled=True)`。
- 新增 `NotificationChannelRouter(adapters, default_channel="in_app")`。
- `payload.channel` 可以路由到同名启用 adapter。
- `payload.channels` 可以按第一个有效渠道路由。
- 未声明渠道时默认走 `in_app`。
- 未知渠道返回失败结果，错误为 `channel_not_configured:<channel>`。
- 禁用渠道返回失败结果，错误为 `channel_disabled:<channel>`，且不调用 adapter。
- 默认 app factory 使用 `NotificationChannelRouter([in_app noop])`，仍然不访问外部网络。

## 本版本不包含

- 不接入真实飞书、邮件、Webhook 或外部 SDK。
- 不新增渠道配置表。
- 不新增通知模板系统。
- 不实现渠道限流、退避、幂等键或回调处理。
- 不新增前端页面。

## TDD 证据

RED：

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_notification_dispatcher_api.py -q
```

结果：失败，原因是 `NotificationChannelAdapter` 和 `NotificationChannelRouter` 尚不存在。

GREEN：

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_notification_dispatcher_api.py -q
```

结果：10 个测试通过；保留一个既有 Starlette `on_event` 弃用警告。

## 最终验证

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_notification_dispatcher_api.py apps/api/tests/test_notification_worker.py apps/api/tests/test_observability_api.py -q
```

结果：25 个测试通过；保留一个既有 Starlette `on_event` 弃用警告。

```powershell
npm run lint
```

结果：通过。

```powershell
npm run build
```

结果：通过；保留既有 Vite chunk-size warning。

```powershell
git diff --check
```

结果：通过；仅提示 Git 将在下次触碰部分文件时把 LF 替换为 CRLF。

## 验收结论

V0.30D 满足当前切片目标：Notification Outbox 已具备本地渠道路由边界，后续可以在不改写 Outbox 状态机的前提下接入真实飞书、邮件或 Webhook adapter。
