# V1 Lite 调度中心设计

## 决策

新增 Workspace 级 `WorkflowSchedule` 资产，固定引用一个不可变 `WorkflowVersion`。调度器不执行 DAG，只负责把到期计划转换为现有 `WorkflowRun + ExecutionJob`，执行继续由 `ExecutionQueueWorker` 完成。

首版采用五段 Cron、IANA 时区、固定输入 JSON、禁止重叠和错过周期不补跑。调度器与执行器运行在同一个 worker 进程内，每个轮询周期先派发到期计划，再消费执行队列。数据库唯一约束保证多 Worker 安全。

## 数据模型

`workflow_schedules`：Workspace、名称、workflowId、workflowVersionId、version、cronExpression、timezone、inputText、status、nextRunAt、lastScheduledFor、lastRunId、createdBy、时间戳。

`schedule_dispatches`：scheduleId、workspaceId、scheduledFor、status（enqueued/skipped/failed）、runId、reason、createdAt。唯一约束 `(schedule_id, scheduled_for)`。

## 运行语义

- 创建/编辑/恢复 active 计划：从当前 UTC 时间之后计算下一个计划点。
- Worker 只认领 `nextRunAt <= now` 的 active 计划。
- 认领后先推进 `nextRunAt` 到未来，故障恢复不会追赶历史周期。
- 若存在同 schedule 的非终态 Run，则记录 skipped。
- 否则复用 `ExecutionService.enqueue_workflow_version` 创建异步 Run/Job，并记录 dispatch。
- 手动“立即执行”不改变 Cron 的 nextRunAt，但同样执行重叠检查和审计。

## 权限

- 列表与调度历史：`run.read`。
- 创建、编辑、暂停、恢复、立即执行：`workspace.manage`。
- 所有查询均显式带 workspaceId。

## 生产部署

`scripts/start-production.sh` 同时启动并守护 Uvicorn 与 `app.worker`。任一关键进程退出时容器退出并由平台重启，避免只剩 API 或只剩 Worker 的半存活状态。

## 明确边界

这不是完整 DolphinScheduler。首版不包含跨工作流依赖、补数、日历、资源池、Worker 分组、告警编排和失败自动重跑。
