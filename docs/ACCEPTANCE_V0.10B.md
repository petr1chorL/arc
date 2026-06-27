# V0.10B 验收说明：Regression Run 详情与筛选

## 本版做了什么

V0.10B 让 Regression Run 历史从“只能看摘要”升级为“可筛选、可点开排查”：

- 后端新增 Run 详情 API。
- 历史区新增 Rubric 筛选和状态筛选。
- 每条 Run 可以打开详情弹窗。
- 详情弹窗展示样本级 Evaluation 记录、输入、得分、状态和评分说明。

## 如何验收

1. 打开评估中心：`/w/ai-capability-center/evaluations`。
2. 确认 `Regression Run History` 区块有 `Run Rubric 筛选` 和 `Run 状态筛选`。
3. 选择某个 Rubric，确认历史列表只保留该 Rubric 的 Run。
4. 选择 `completed` 状态，确认列表继续按状态收窄。
5. 点击某条 Run 的“查看 Run 详情”。
6. 确认弹窗展示 Run ID、通过率、样本数量、运行上下文和样本级评估。
7. 确认每条样本级评估包含 Evaluation ID、样本输入、分数、状态和评分说明。

## 通过标准

- 筛选不会影响 Rubric、Golden Set、批量回归和 Evaluation 历史。
- Run 详情能从后端重新读取，不只依赖列表摘要。
- 浏览器控制台无 error / warning。

## 当前边界

- 当前不做跨 Run 对比。
- 当前不做 Run 重新运行、取消或重试。
- 当前不做异步状态轮询。
