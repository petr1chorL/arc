# V0.31B 验收记录：Notification Channel Settings

更新时间：2026-06-29

## 第一性原理

后端渠道资产如果只能通过 API 操作，就还不是可运营的治理能力。Workspace 管理员需要在平台界面里完成最小闭环：看见渠道、创建渠道、停用渠道，并且明确这只是配置资产，不是外部消息发送入口。

## 对抗式审查

- 页面没有“密钥值”输入，只填写 `secretRef` 标签。
- 页面不提供连接测试或发送测试。
- 配置 JSON 在前端阻断非法 JSON 和非对象 JSON。
- disabled 渠道不再展示可用的停用动作。
- 文档明确本版本不发送真实飞书、邮件或 Webhook。

## 已实现

- 新增 `src/api/notificationChannels.ts`。
- 新增通知渠道类型定义。
- 新增 `/w/:workspaceSlug/settings/notification-channels` 页面。
- 侧栏新增“通知渠道”入口。
- 页面支持列表、创建、前端 config JSON 校验和停用。
- 创建成功后列表插入新渠道并清空表单。
- 停用成功后更新卡片状态并移除停用入口。

## 非目标

- 不新增后端接口。
- 不做真实外部通知发送。
- 不保存真实凭证值。
- 不做连接测试。
- 不新增通知模板、限流、退避或幂等。

## TDD 证据

- RED：`npm run test -- src/api/notificationChannels.test.ts src/pages/NotificationChannels.test.tsx src/components/Layout.test.tsx --run` 曾失败，因为 API 模块、页面模块和侧栏入口不存在。
- GREEN：实现后同一命令通过，`3 passed / 13 tests passed`。

## 最终验证

- `npm run test -- src/api/notificationChannels.test.ts src/pages/NotificationChannels.test.tsx src/components/Layout.test.tsx --run`：通过，`3 passed / 13 tests passed`。
- `apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_notification_dispatcher_api.py -q`：通过，`17 passed`。
- `npm run lint`：通过。
- `npm run build`：通过；保留既有 Vite chunk size warning。
- `git diff --check`：通过；仅有 Windows 换行提示。
