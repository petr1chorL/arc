# V0.10D Regression Run 趋势 PRD

## Problem Statement

V0.10C 已经支持两次 Regression Run 对比，但用户仍然需要手动选择 Run 才能判断质量是否持续改善。评估中心缺少一个默认可见的趋势视图，用于快速回答“最近几次回归整体是在变好还是变差”。

## Solution

在 `Regression Run History` 区域增加 `Regression Run Trend` 视图，基于当前已加载的 Regression Run 列表计算趋势摘要和轻量柱状趋势。趋势视图复用现有列表数据，不新增后端 API。

## User Stories

- 作为构建者，我可以直接看到最近几次 Regression Run 的通过率趋势。
- 作为质量负责人，我可以看到最新通过率、较上次变化、平均通过率和最佳通过率。
- 作为排障人员，我可以看到低通过率 Run，快速决定是否打开详情或做两次对比。

## Implementation Decisions

- 趋势计算在前端完成，基于 `filteredRegressionRuns`。
- 趋势按 `createdAt` 从旧到新排序，最多展示最近 8 次。
- 趋势摘要包含最新通过率、较上次变化、平均通过率、最佳通过率和运行次数。
- 低于 70% 的 Run 在趋势条中标记为风险。
- 暂不引入图表库，继续使用原生 CSS 轻量图形。

## Testing Decisions

- 使用 Vitest + Testing Library 写前端行为测试。
- 红测先验证缺少 `Regression Run Trend` 区块。
- 绿测验证趋势摘要、运行次数、通过率变化和 Run ID 可见。

## Out of Scope

- 后端趋势聚合 API。
- 时间范围选择器。
- 图表库。
- 趋势导出报告。

## Further Notes

本切片是质量趋势的第一版，后续可扩展成 V0.10E 的趋势筛选和报告导出。
