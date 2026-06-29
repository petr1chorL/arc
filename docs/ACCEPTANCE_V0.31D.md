# V0.31D 验收记录：Notification Remediation Guidance

更新时间：2026-06-29

## 第一性原理

通知失败码只有变成下一步动作才有运营价值。`notification_channel_missing`、`notification_channel_disabled` 和 `channel_not_configured` 代表不同处理路径：新增渠道资产、恢复渠道资产、或开发接入 adapter。页面必须帮助用户区分它们。

## 对抗式审查

- 建议不隐藏原始失败码和错误文本。
- 建议不声称系统已自动修复。
- `channel_not_configured` 不被描述成用户配置错误，而是 adapter 尚未接入。
- “打开通知渠道”链接保持当前 Workspace。
- 不新增后端接口、自动重试、自动重新入队或真实外部发送。

## 已实现

- 通知列表失败项展示“排障建议”。
- 发送器结果明细失败项展示“排障建议”。
- `notification_channel_missing` 提示新增 active 渠道资产。
- `notification_channel_disabled` 提示恢复或新建 active 渠道。
- `channel_not_configured` 提示后端 adapter 尚未接入。
- 失败码筛选新增 `notification_channel_missing` 和 `notification_channel_disabled`。
- 建议区提供当前 Workspace 的通知渠道设置页链接。

## 非目标

- 不自动创建渠道资产。
- 不自动启用渠道。
- 不自动重试或重新入队。
- 不接入真实飞书、邮件或 Webhook。

## TDD 证据

- RED：`npm run test -- src/pages/Notifications.test.tsx --run` 曾失败，因为页面未渲染通知列表和 dispatch 明细的排障建议。
- GREEN：实现后同一命令通过，`1 passed / 7 tests passed`。

## 最终验证

- `npm run test -- src/pages/Notifications.test.tsx src/api/notifications.test.ts src/api/notificationChannels.test.ts --run`：通过，`3 passed / 12 tests passed`。
- `apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_notification_dispatcher_api.py -q`：通过，`20 passed`。
- `npm run lint`：通过。
- `npm run build`：通过；保留既有 Vite chunk size warning。
- `git diff --check`：通过；仅有 Windows 换行提示。
