# V0.10E Regression Run 质量洞察摘要验收

## 验收目标

确认评估中心不仅展示 Regression Run 趋势，还能给出一条可读的质量判断和下一步建议。

## 前置条件

- 已登录本地 ARC.ONE。
- 当前 Workspace 至少有 2 次 Regression Run。
- 如果 Run 不足 2 次，可在评估中心使用同一个 Rubric 连续运行两次批量回归。

## 验收步骤

1. 打开 `http://127.0.0.1:4173/w/ai-capability-center/evaluations`。
2. 滚动到 `Regression Run History`。
3. 确认出现 `Regression Run Trend` 区块。
4. 确认趋势区内出现 `Regression Run Insight` 洞察卡。
5. 确认洞察卡展示：
   - 状态标题，例如质量下滑、质量风险、轻微回落、质量改善或质量稳定。
   - 最新通过率。
   - 较上次变化。
   - 风险 Run 数。
   - 建议文案。
6. 切换 Rubric 或 Run 状态筛选，确认洞察卡会随当前筛选后的趋势刷新。

## 不通过判定

- 有 2 次以上 Run 时没有洞察卡。
- 洞察卡没有状态标题。
- 洞察卡缺少最新通过率、较上次变化或风险 Run 数。
- 最新 Run 低于 70% 或较上次下降时没有建议文案。
- 原有趋势图、Run 详情或 Run 对比不可用。

## 当前限制

- 洞察由前端确定性规则生成，不调用 LLM。
- 风险线固定为 70%，暂不支持用户配置。
- 暂不做报告导出、原因归因和跨 Rubric 汇总。
