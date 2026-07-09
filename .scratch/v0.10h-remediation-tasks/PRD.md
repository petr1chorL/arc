# V0.10H 失败修复任务 PRD

## 问题陈述

V0.10G 的 `Failure Remediation Queue` 能展示修复建议，但这些建议刷新后仍然只是页面派生信息。用户需要把某个修复建议转成可追踪任务，并能看到任务处理状态。

## 解决方案

新增 Workspace 级 `Remediation Task` API，并在评估中心支持从修复队列创建任务、展示任务列表、将任务标记为处理中或已完成。

## 用户故事

- 作为质量负责人，我能把一个失败原因转成可追踪任务。
- 作为构建者，我能看到任务的优先级、建议动作、代表样本和来源 Regression Run。
- 作为验收人，我能把任务从 `open` 推进到 `in_progress` 或 `done`，知道哪些问题已经处理。

## 实施决策

- 后端新增 `remediation_tasks` 表，归属 Workspace。
- 任务与 Regression Run 关联，保存 failure cluster key、title、priority、sample IDs、action 和 status。
- `POST /api/workspaces/{workspace_id}/evaluations/remediation-tasks` 创建任务。
- `GET /api/workspaces/{workspace_id}/evaluations/remediation-tasks` 列表读取。
- `PATCH /api/workspaces/{workspace_id}/evaluations/remediation-tasks/{task_id}` 更新状态。
- 允许相同 Workspace 下同一个 `sourceRunId + clusterKey` 只创建一个任务；重复创建返回已有任务。

## 测试决策

- 先写后端 API 红测：创建任务、重复创建幂等、状态更新。
- 再写前端红测：点击修复项创建任务，任务列表出现，点击按钮后状态更新。
- 浏览器验收使用真实登录和真实 Regression Run。

## 范围外

- 不做任务分配人、截止时间、评论、附件。
- 不自动触发复测。
- 不接入外部通知。
- 不做跨页面任务中心。

