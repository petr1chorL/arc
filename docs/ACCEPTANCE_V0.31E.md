# V0.31E Notification Channel Impact 验收记录

## 第一性原理

通知渠道设置页必须回答“这个渠道当前影响多少失败通知”，否则 V0.31D 的“打开通知渠道”建议会停留在静态配置页，不能形成排障闭环。

## 对抗式审查

失败影响面只是运营提示，不代表真实外部投递、自动恢复、连接测试或后端聚合能力。页面仍不得展示密钥值；失败通知加载失败时不应阻断渠道资产管理。

## 验收标准

- [x] 渠道设置页会加载当前 Workspace 的失败 Notification Outbox。
- [x] 每个渠道卡片展示该渠道的失败通知数量。
- [x] 有失败通知的渠道展示主要失败码。
- [x] 渠道卡片提供跳转到当前 Workspace 通知运维页并带 `channel` 查询参数的链接。
- [x] 失败影响面加载失败时，页面提示影响面不可用，但渠道资产列表仍可见。

## 验证证据

- RED：`npm run test -- src/pages/NotificationChannels.test.tsx --run` 失败，新增用例证明当前页面没有失败影响面和加载失败提示。
- GREEN：`npm run test -- src/pages/NotificationChannels.test.tsx --run` 通过，5 tests passed。
- 回归：`npm run test -- src/pages/NotificationChannels.test.tsx src/pages/Notifications.test.tsx src/api/notifications.test.ts src/api/notificationChannels.test.ts --run` 通过，17 tests passed。
- 后端通知回归：`apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_notification_dispatcher_api.py -q` 通过，20 passed。
- 静态检查：`npm run lint` 通过。
- 构建：`npm run build` 通过，保留既有 Vite chunk size warning。
- 浏览器验证：使用 Chrome 打开 `/w/ai-capability-center/settings/notification-channels` 并拦截当前 Workspace API，确认页面展示“失败影响”“2 条失败通知”“notification_channel_missing”“channel_not_configured”，跳转链接为 `/w/ai-capability-center/notifications?channel=webhook`。
