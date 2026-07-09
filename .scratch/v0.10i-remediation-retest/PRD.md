# V0.10I PRD：修复任务关联复测

## 问题陈述

V0.10H 已经能把失败原因转成修复任务，但任务完成后，用户还不能在同一闭环里证明“修复是否有效”。这会导致任务状态和质量结果脱节：任务可以被标记为完成，但没有对应的 Regression Run 复测证据。

## 解决方案

为 Remediation Task 增加一键复测能力：

- 只允许已完成任务发起复测。
- 复测使用任务来源 Regression Run 的同一 Rubric。
- 复测样本来自任务记录的代表样本 ID，对应来源 Run 中的 Evaluation 记录。
- 复测创建新的 Regression Run，并把新 Run ID 写回 Remediation Task。
- 前端在任务卡展示复测入口、复测 Run ID、通过率和失败数。

## 用户故事

作为质量负责人，我希望修复任务完成后能直接复测相关样本，从而确认这次修复是否真的提升了质量。

作为平台管理员，我希望任务上能看到关联复测 Run，避免“任务完成”和“质量达标”之间没有证据链。

## 实施决策

- 新增 `RemediationTaskRecord.retest_run_id`，默认 `null`。
- `RemediationTaskRead` 返回 `retestRunId` 和可选 `retestRun` 摘要。
- 新增 API：`POST /api/workspaces/{workspace_id}/evaluations/remediation-tasks/{task_id}/retest`。
- 复测 Run 使用来源 Run 的 `rubric_id`。
- 复测样本从来源 Run 的 Evaluation 记录中按 `subjectId` 匹配 `sampleIds`。
- 复测 Run `sampleSetName` 使用 `修复复测`，并保留手动样本路径，不引入新的样本集资产。
- 如果任务未完成，返回 409。
- 如果来源 Run 或样本记录不完整，返回 422。
- 如果已经有 `retestRunId`，重复点击返回已有任务和复测摘要，不重复创建 Run。

## 测试决策

- 后端 focused 测试覆盖：
  - 已完成任务可以发起复测。
  - 任务保存 `retestRunId`。
  - 返回任务中包含 `retestRun` 摘要。
  - 重复复测不创建重复 Run。
  - 未完成任务不能复测。
- 前端 focused 测试覆盖：
  - 任务完成后出现 `发起复测`。
  - 点击后展示复测 Run、通过率和失败数。

## 范围外

- 不做任务负责人、截止时间、评论。
- 不做自动复测调度。
- 不做复测失败自动重开任务。
- 不做 LLM 生成修复建议。

