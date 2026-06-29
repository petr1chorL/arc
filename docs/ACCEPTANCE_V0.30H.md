# V0.30H 验收记录：Notification Requeue View

## 第一性原理

- V0.30G 只解决“看见通知失败”，V0.30H 解决最小下一步：“人工确认后把失败通知重新放回待发送队列”。
- 最小闭环是失败通知、操作原因、requeue API 和刷新后的列表；批量重投、自动重试和真实外部发送都不是当前闭环的必要条件。
- 重新入队原因是审计恢复动作的最低证据，不是可选备注。

## 对抗式审查

- 只对 `status=failed` 的通知展示“重新入队”，避免未来真实渠道接入后误重发 `sent` 或 `pending` 通知。
- 空原因在前端阻断，不调用 API。
- API 失败时不关闭原因面板，不清空用户输入，并展示错误，避免制造“已恢复”的错误完成感。
- 页面复用 Workspace-scoped requeue API，不新增并行接口或绕过后端权限与审计。

## 已实现

- `src/api/notifications.ts` 新增 `requeueNotification(workspaceId, notificationId, reason)`。
- 通知运维页失败通知卡片新增“重新入队”入口。
- 点击后展示“重新入队原因”输入区、“确认重新入队”和“取消”动作。
- 成功后刷新当前筛选下的 Notification Outbox 列表。
- 失败时展示错误并保留原因输入。

## 本版本不包含

- 不新增批量重新入队。
- 不新增自动重试、退避或限流。
- 不新增真实飞书、邮件或 Webhook 发送。
- 不新增单条通知详情页。
- 不新增后端接口或数据库字段。
- 不新增权限差异 UI。

## TDD 证据

- RED：`npm run test -- src/api/notifications.test.ts src/pages/Notifications.test.tsx --run` 失败，原因包括 `requeueNotification is not a function`，以及页面找不到“重新入队 notification-failed”。
- GREEN：同一命令通过，2 个测试文件、6 条测试用例全部通过。

## 最终验证

- `npm run test -- src/api/notifications.test.ts src/pages/Notifications.test.tsx src/components/Layout.test.tsx --run`：通过，3 个测试文件、13 条测试用例。
- `npm run lint`：通过。
- `npm run build`：通过；Vite 报告单个 chunk 超过 500 kB 的既有体积提示，不阻断构建。
- `git diff --check`：通过；仅提示部分工作区文件未来被 Git 触碰时会从 LF 转 CRLF。
- `Invoke-WebRequest -Uri http://127.0.0.1:4173/w/ai-capability-center/notifications -UseBasicParsing`：返回 HTTP 200。
