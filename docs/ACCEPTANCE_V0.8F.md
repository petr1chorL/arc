# V0.8F 轻量告警 / 通知 Outbox 验收说明

## 本版新增

V0.8F 在运行观测中心增加页面内“告警 Outbox”，把需要处理的运行异常和已有 SLA 通知集中展示，作为后续外部通知发送器的前置视图。

## 已实现能力

- `GET /api/workspaces/{workspace_id}/observability/overview` 返回 `alerts` 数组。
- `alerts` 当前包含两类来源：
  - 由失败、恢复失败、人工审核阻塞等运行风险投影出的 in-app 告警。
  - 已写入 `NotificationOutboxRecord` 的人工 SLA 提醒或升级通知。
- 每条 alert 包含：
  - `eventKey`
  - `eventType`
  - `severity`
  - `channel`
  - `status`
  - `runId`
  - `humanTaskId`
  - `message`
  - `nextAction`
- 运行观测页展示“告警 Outbox”面板。
- Outbox 会跟随当前运行筛选条件，只展示当前可见运行相关的告警。

## 验收路径

1. 打开 `http://127.0.0.1:4173/w/ai-capability-center/observability`。
2. 查看指标区下方是否出现“告警 Outbox”面板。
3. 找到失败运行对应的告警，确认能看到：
   - 告警标题
   - 事件类型，如 `run_failure`
   - 严重级别
   - `in_app / pending`
   - 下一步处理建议
4. 使用运行状态、工作流名称、风险等级或失败原因筛选，确认 Outbox 里的告警跟随当前运行列表变化。

## 范围外

- 本版不发送飞书、邮件、Webhook 或短信。
- 本版不做通知确认、重试、发送失败处理。
- 本版不引入后台任务队列。
- `NotificationOutboxRecord` 的外部消费者留到后续版本。
