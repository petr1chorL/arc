# V0.10C Regression Run 对比 PRD

## Problem Statement

V0.10A/V0.10B 已经让 Regression Run 可以持久化、筛选和查看详情，但用户仍需要逐个打开 Run 才能判断质量是否变好。平台缺少一个轻量对比入口，帮助用户快速看清两次回归之间的通过率、失败样本和样本级状态变化。

## Solution

在评估中心的 `Regression Run History` 区域增加两次 Run 的对比能力。用户选择一个基准 Run 和一个目标 Run 后，平台读取两次 Run 的详情，并在页面内展示差异摘要与样本级变化。

## User Stories

- 作为构建者，我可以选择两次 Regression Run 进行对比，以判断新版本是否改善质量。
- 作为质量负责人，我可以看到通过率、通过样本数、失败样本数和总样本数的变化。
- 作为排障人员，我可以看到样本从失败变通过、从通过变失败、持续失败或新增失败的变化。

## Implementation Decisions

- 不新增后端 API；复用 `GET /evaluations/regression-runs/{run_id}`。
- 对比逻辑在前端完成，基于两次 Run 的 `records` 和 `subjectId` 计算。
- 当同一 `subjectId` 出现在两次 Run 中时判断状态变化；只出现在目标 Run 中的失败样本标记为新增失败。
- 当前不做趋势图和跨多次 Run 统计，避免引入图表库和更复杂的聚合模型。

## Testing Decisions

- 使用 Vitest + Testing Library 写前端行为测试。
- 红测先验证页面缺少 Run 对比控件。
- 绿测验证选择两次 Run 后会请求两个详情 API，并展示通过率变化、失败样本变化和样本级变化。

## Out of Scope

- 多 Run 趋势图。
- 后端聚合对比 API。
- 报告导出。
- 定时回归后的自动趋势分析。

## Further Notes

本切片是 V0.10C 的最小闭环，为后续趋势图、报告导出和质量看板打基础。
