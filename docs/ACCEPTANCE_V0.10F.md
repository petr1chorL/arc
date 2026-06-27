# V0.10F 失败样本聚类与原因摘要验收

## 验收目标

确认评估中心能基于最新 Regression Run 的失败样本，展示主要失败原因分布，帮助优先处理最集中的质量问题。

## 前置条件

- 已登录本地 ARC.ONE。
- 当前 Workspace 至少有 2 次 Regression Run。
- 最新 Run 至少包含 1 条失败 Evaluation 记录。

## 验收步骤

1. 打开 `http://127.0.0.1:4173/w/ai-capability-center/evaluations`。
2. 滚动到 `Regression Run History`。
3. 确认出现 `Regression Run Trend` 区块。
4. 确认趋势区内出现 `Failure Pattern Summary`。
5. 确认摘要区展示：
   - 最新失败样本总数。
   - 至少一个失败原因组。
   - 每个原因组的样本数。
   - 平均分和最低分。
   - 代表样本 ID。
   - 处理建议。
6. 切换 Rubric 或 Run 状态筛选，确认摘要区会基于当前筛选后的最新 Run 刷新。

## 不通过判定

- 最新 Run 有失败记录但不显示 `Failure Pattern Summary`。
- 失败原因组没有样本数或代表样本 ID。
- 原有趋势图、洞察卡、Run 详情或 Run 对比不可用。
- 没有失败记录时仍显示误导性的失败摘要。

## 当前限制

- 聚类由前端确定性规则生成，不调用 LLM。
- 只分析当前筛选后的最新 Run。
- 每条失败样本按最低评分维度归类。
- 最多展示 3 个原因组。

## 本轮验证证据

- `npm test -- --run src/pages/Evaluations.test.tsx`：13 项通过；覆盖列表接口不返回 records、详情接口补拉 records 后渲染失败聚类。
- 浏览器验收：本地登录后创建 Regression Sample Set，运行 Regression Run，评估中心展示 `Failure Pattern Summary` 与 1 个失败原因聚类卡。
- 截图：`.scratch/v0.10f-failure-pattern-summary.png`。
- 结果文件：`.scratch/v0.10f-browser-result.json`。
