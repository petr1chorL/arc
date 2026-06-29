# V0.31F Notification Channel Enable 验收记录

## 第一性原理

渠道治理必须支持 active 与 disabled 的双向人工控制。只有停用、没有恢复，会让 `notification_channel_disabled` 的排障建议不可执行。

## 对抗式审查

恢复 active 只代表平台治理状态，不代表真实外部渠道连通；不做连接测试，不自动重新入队失败通知，必须保持 Workspace 隔离和审计记录。

## 验收标准

- [x] 后端提供 `POST /notification-channels/{channel_id}/enable`。
- [x] disabled 渠道恢复后返回 `status=active` 并更新 `updatedAt`。
- [x] 恢复渠道写入 `notification_channel.enable` 审计事件，记录 before/after status 和渠道信息。
- [x] 跨 Workspace 或不存在渠道恢复返回 404。
- [x] 前端 disabled 渠道展示“恢复启用”，成功后状态变 active。

## 验证证据

- 后端 RED：`apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_notification_dispatcher_api.py -q` 失败，新增 enable 用例因路由不存在返回 404。
- 后端 GREEN：新增 enable API 后，同一命令通过，22 passed。
- 前端 RED：`npm run test -- src/api/notificationChannels.test.ts src/pages/NotificationChannels.test.tsx --run` 失败，原因是 `enableNotificationChannel` 不存在且页面没有“恢复启用”按钮。
- 前端 GREEN：新增 API wrapper 和 disabled 卡片恢复按钮后，同一命令通过，9 tests passed。
- 回归：`npm run test -- src/api/notificationChannels.test.ts src/pages/NotificationChannels.test.tsx src/pages/Notifications.test.tsx src/api/notifications.test.ts --run` 通过，19 tests passed。
- 后端通知回归：`apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_notification_dispatcher_api.py -q` 通过，22 passed。
- 静态检查：`npm run lint` 通过。
- 构建：`npm run build` 通过，保留既有 Vite chunk size warning。
- 浏览器验证：Chrome 渲染 disabled 渠道，点击“恢复启用 Webhook 告警”后状态变为 active，并出现“停用 Webhook 告警”按钮。
