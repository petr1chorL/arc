# V0.30C 验收记录：Notification Outbox 失败重新入队

## 第一性原理

通知系统的底层目标是“关键事件最终可达”。V0.30A/B 已经具备发送接口和后台消费入口，但如果失败通知没有恢复路径，Outbox 只是在记录失败，不是在支撑可靠通知链路。

本版本选择手动重新入队，而不是自动重试，因为自动重试还需要真实渠道限流、幂等键、退避策略和重复发送治理；这些能力当前尚未建立。

## 对抗式审查

- 已发送通知不能重新入队，避免未来接入真实渠道后重复发送。
- 失败证据不能被覆盖，上一轮 `payload.dispatch` 会进入 `dispatchHistory`。
- 操作必须有审计事件和原因。
- 跨 Workspace 通知不能被当前 Workspace 操作。
- 文档明确本版本不是自动重试系统，也不发送真实外部通知。

## 已实现

- 新增 `POST /api/workspaces/{workspace_id}/notifications/outbox/{notification_id}/requeue`。
- 仅允许 `failed -> pending`。
- `sent` 或 `pending` 通知重新入队返回 409。
- 跨 Workspace 或不存在通知返回 404。
- 保留上一轮 `payload.dispatch` 到 `payload.dispatchHistory`。
- 当前 `payload.dispatch` 写入 pending 状态、`requeuedAt` 和 `reason`。
- 成功操作写入 `notification_outbox.requeue` 审计事件。

## 本版本不包含

- 不实现自动重试。
- 不实现退避策略。
- 不实现渠道限流。
- 不实现幂等发送键。
- 不接入真实飞书、邮件、Webhook 或外部 SDK。
- 不新增前端页面。

## TDD 证据

RED：

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_notification_dispatcher_api.py -q
```

结果：失败，原因是 requeue 路由不存在，相关请求返回 404。

GREEN：

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_notification_dispatcher_api.py -q
```

结果：5 个测试通过。

## 最终验证

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_notification_dispatcher_api.py apps/api/tests/test_notification_worker.py apps/api/tests/test_observability_api.py -q
```

结果：20 个测试通过；保留一个既有 Starlette `on_event` 弃用警告。

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

V0.30C 满足当前切片目标：失败通知可以被人工、可审计、可追溯地重新放回待发送队列，同时不会误操作已发送通知或跨 Workspace 通知。
