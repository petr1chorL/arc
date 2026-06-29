# V0.30E 验收记录：Notification Dispatch Metadata

## 第一性原理

通知可靠性的底层问题不是“有没有错误文案”，而是能否稳定判断失败发生在哪个渠道、属于哪类失败、是否适合重试或人工处理。因此派发结果需要结构化事实：实际渠道、稳定失败码、人类可读错误说明，以及持久化到 Outbox 的同一份证据。

## 对抗式审查

- 不能用 `errorCode` 替代 `error`，否则排障人员会失去上下文。
- 不能靠解析错误字符串做统计，必须提供稳定字段。
- 不能新增数据库字段制造过早结构化成本，本版先写入 JSON payload。
- 不能破坏旧 adapter 返回 dict 的兼容性。
- 不能把失败码写成重试策略，本版只提供事实，不做自动决策。

## 已实现

- `NotificationDispatchResult` 新增 `channel` 和 `error_code`。
- dict adapter 返回 `error_code` 或 `errorCode` 都会被规范化。
- Channel Router 会给 adapter 结果补充实际路由渠道。
- 未知渠道失败码为 `channel_not_configured`。
- 禁用渠道失败码为 `channel_disabled`。
- dispatch API item 返回 `channel` 和 `errorCode`。
- `payload.dispatch` 写入 `channel` 和 `errorCode`。

## 本版本不包含

- 不新增数据库字段。
- 不新增前端页面。
- 不新增自动重试策略。
- 不接入真实外部渠道。
- 不改变 Outbox 状态机。

## TDD 证据

RED：

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_notification_dispatcher_api.py -q
```

结果：失败，4 个用例因响应 item 缺少 `channel` 字段而失败。

GREEN：

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_notification_dispatcher_api.py -q
```

结果：11 个测试通过；保留一个既有 Starlette `on_event` 弃用警告。

## 最终验证

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_notification_dispatcher_api.py apps/api/tests/test_notification_worker.py apps/api/tests/test_observability_api.py -q
```

结果：26 个测试通过；保留一个既有 Starlette `on_event` 弃用警告。

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

V0.30E 满足当前切片目标：通知派发结果已经具备渠道和失败码结构化字段，后续可用于告警聚合、排障建议和人工恢复判断。
