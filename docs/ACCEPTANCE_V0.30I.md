# V0.30I 验收记录：Notification Dispatch View

## 第一性原理

- V0.30H 解决失败通知重新入队，但 pending 通知仍需要交给发送器消费。
- V0.30I 的最小目标是让运维人员在通知运维页触发一次已有发送器，并看到本次处理摘要。
- 该动作是“触发发送器”，不是承诺真实外部渠道已送达。

## 对抗式审查

- 页面只调用 Workspace-scoped dispatch API，不在前端逐条发送通知。
- 成功后展示 processed、sent、failed 摘要，并刷新列表，避免用户不知道动作结果。
- API 失败时展示错误，并清空新的成功摘要，避免旧成功信息误导用户。
- 不新增自动轮询或隐藏重复发送，避免真实渠道接入后出现不可控重复触达。

## 已实现

- `src/types.ts` 新增 `NotificationDispatchItem` 与 `NotificationDispatchSummary`。
- `src/api/notifications.ts` 新增 `dispatchNotifications(workspaceId)`。
- 通知运维页新增“触发发送器”按钮。
- 触发成功后展示“本次处理 X 条 / 已发送 X 条 / 失败 X 条”摘要。
- 触发成功后刷新当前筛选下的 Notification Outbox 列表。
- 触发失败时展示错误，不展示新的成功摘要。

## 本版本不包含

- 不新增真实飞书、邮件或 Webhook 发送实现。
- 不新增单条通知发送。
- 不新增批量选择或部分发送。
- 不新增自动轮询、定时消费或 Worker 控制台。
- 不新增后端接口、数据库字段或权限模型。

## TDD 证据

- RED：`npm run test -- src/api/notifications.test.ts src/pages/Notifications.test.tsx --run` 失败，原因包括 `dispatchNotifications is not a function`，以及页面找不到“触发发送器”。
- GREEN：同一命令通过，2 个测试文件、9 条测试用例全部通过。

## 最终验证

- `npm run test -- src/api/notifications.test.ts src/pages/Notifications.test.tsx src/components/Layout.test.tsx --run`：通过，3 个测试文件、16 条测试用例。
- `npm run lint`：通过。
- `npm run build`：通过；Vite 报告单个 chunk 超过 500 kB 的既有体积提示，不阻断构建。
- `git diff --check`：通过；仅提示部分工作区文件未来被 Git 触碰时会从 LF 转 CRLF。
- `Invoke-WebRequest -Uri http://127.0.0.1:4173/w/ai-capability-center/notifications -UseBasicParsing`：返回 HTTP 200。
