# V0.31A 验收记录：Notification Channel Assets

更新时间：2026-06-29

## 第一性原理

真实外部通知的底层前提不是“先写一个飞书或 Webhook SDK 调用”，而是平台必须先有 Workspace 级渠道治理边界：当前空间有哪些通知渠道、渠道是否启用、非密钥配置是什么、凭证引用标签是什么。没有这个边界，真实外发会把凭证、启停和 Workspace 隔离问题藏进代码部署。

## 对抗式审查

- 不保存、读取或回显真实密钥值，只保存 `secretRef` 标签。
- 不把渠道资产误写成真实飞书、邮件或 Webhook 已经可发送。
- 不把新资产接入 dispatch 路由，避免未验证 adapter 语义影响 V0.30 稳定发送骨架。
- 不允许跨 Workspace 停用渠道。
- 不允许同一 Workspace 内渠道重名。
- 不新增连接测试、通知模板、限流、退避、幂等或回调处理。

## 已实现

- 新增 `NotificationChannelRecord` 和 `notification_channels` 表。
- 新增 Workspace 级创建、列表、停用 API。
- 创建返回 id、workspaceId、name、channelType、status、config、secretRef、createdAt 和 updatedAt。
- `config` 只接受 JSON object。
- 同一 Workspace 重名返回 409。
- 列表只返回当前 Workspace 渠道，并按创建时间倒序。
- 停用渠道写入 `notification_channel.disable` 审计事件。
- 跨 Workspace 停用返回 404。

## 非目标

- 不接入真实外部发送。
- 不做渠道连接测试。
- 不保存真实凭证值。
- 不新增前端渠道配置页面。
- 不新增通知模板系统。

## TDD 证据

- RED：`apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_notification_dispatcher_api.py -q` 曾失败，4 个新用例因 `/notification-channels` 返回 404 失败。
- GREEN：实现后同一命令通过，`17 passed`。

## 最终验证

- `apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_notification_dispatcher_api.py -q`：通过，`17 passed`。
- `npm run test -- src/api/notifications.test.ts src/pages/Notifications.test.tsx src/components/Layout.test.tsx --run`：通过，`3 passed / 17 tests passed`。
- `npm run lint`：通过。
- `npm run build`：通过；保留既有 Vite chunk size warning。
- `git diff --check`：通过；仅有 Windows 换行提示。
