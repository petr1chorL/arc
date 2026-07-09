# V0.10A 验收说明：Regression Run 历史

## 本版做了什么

V0.10A 把“批量回归”从前端逐条调用评估 API，升级为一次正式的 Regression Run：

- 每次批量回归会创建一条 Regression Run 摘要。
- Run 会记录 Rubric、Golden Set、样本总数、通过数、失败数、通过率和关联 Evaluation IDs。
- 每条样本仍会生成独立 Evaluation 记录。
- 评估中心新增 `Regression Run History`，刷新页面后仍能看到历史运行。

## 如何验收

1. 打开评估中心：`/w/ai-capability-center/evaluations`。
2. 确认页面有 `Regression Run History` 区块。
3. 选择一个 active Rubric。
4. 选择一个已有 Golden Set，或在“回归样本”里手动输入多条样本。
5. 点击“运行批量回归”。
6. 确认批量结果区展示通过率、样本数、通过数、失败数和每条样本结果。
7. 确认 `Regression Run History` 顶部出现新的 Run。
8. 刷新页面，确认该 Run 仍然存在。

## 通过标准

- 新 Run 展示 Run ID、Golden Set 或手动样本、Rubric 名称与版本。
- 新 Run 展示样本总数、通过数、失败数、通过率和 Evaluation 数。
- Evaluation 记录列表中可以看到本次 Run 生成的记录。
- 浏览器控制台无 error / warning。

## 当前边界

- 当前 Run 是同步执行，不是后台队列。
- 当前没有定时回归、并发调度、Run 取消和重试。
- 当前评分器仍是确定性评分器，LLM-as-a-Judge 尚未接入。
