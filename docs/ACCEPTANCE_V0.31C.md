# V0.31C 验收记录：Notification Channel Dispatch Guard

更新时间：2026-06-29

## 第一性原理

通知 dispatch 的失败结果必须能解释治理状态。如果业务通知声明了 Webhook，但 Workspace 没有 Webhook 渠道资产、渠道资产已停用、或者后端还没接入 Webhook adapter，这三种情况的处理动作完全不同，不能全部混成 `channel_not_configured`。

## 对抗式审查

- active 渠道资产不代表真实外部消息已经可发送。
- `in_app` 继续作为内置默认渠道，不要求资产记录。
- 显式注入自定义 dispatcher/router 的测试路径不启用资产预检，避免破坏 adapter 扩展边界。
- 不读取、解析或保存真实密钥。
- 不新增数据库字段、前端页面、连接测试或真实外部 adapter。

## 已实现

- 新增 `resolve_notification_channel` 和 `normalize_channel_name`。
- `NotificationOutboxDispatchService` 新增可选 `require_channel_assets`。
- 默认 app dispatcher 路径启用渠道资产预检。
- 非 `in_app` 渠道缺少资产时返回 `notification_channel_missing`。
- 非 `in_app` 渠道只有 disabled 资产时返回 `notification_channel_disabled`。
- active 资产存在但 adapter 未注册时继续返回 `channel_not_configured`。
- 显式注入 adapter 的既有测试保持通过。

## 非目标

- 不接入真实飞书、邮件或 Webhook。
- 不解析 `secretRef`。
- 不新增通知模板、限流、退避或幂等。
- 不新增前端页面。

## TDD 证据

- RED：`apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_notification_dispatcher_api.py -q` 曾失败，缺失/停用渠道资产仍返回 `channel_not_configured`。
- GREEN：实现后同一命令通过，`20 passed`。

## 最终验证

- `apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_notification_dispatcher_api.py -q`：通过，`20 passed`。
- `npm run test -- src/api/notificationChannels.test.ts src/pages/NotificationChannels.test.tsx src/api/notifications.test.ts src/pages/Notifications.test.tsx --run`：通过，`4 passed / 15 tests passed`。
- `npm run lint`：通过。
- `npm run build`：通过；保留既有 Vite chunk size warning。
- `git diff --check`：通过；仅有 Windows 换行提示。
