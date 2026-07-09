# V0.10G 失败原因修复队列验收

## 验收目标

确认评估中心能把最新 Regression Run 的失败原因组转成可行动的修复队列，帮助用户知道先修什么、怎么修、修完后复测哪些样本。

## 前置条件

- 已登录本地 ARC.ONE。
- 当前 Workspace 至少有 1 次包含失败样本的 Regression Run。
- 评估中心能看到 `Failure Pattern Summary`。

## 验收步骤

1. 打开 `http://127.0.0.1:4173/w/ai-capability-center/evaluations`。
2. 滚动到 `Regression Run History` 的趋势区。
3. 确认出现 `Failure Pattern Summary`。
4. 确认其下方出现 `Failure Remediation Queue`。
5. 确认每个修复项展示：
   - 优先级，如 `P0`、`P1`、`P2`。
   - 修复标题，如 `修复 Evidence 偏低`。
   - 关联样本数和最低分。
   - 建议动作。
   - 代表样本 ID。
   - 复测提示。
6. 切换 Rubric 或 Run 状态筛选，确认队列会跟随当前筛选后的最新 Run 更新。

## 不通过判定

- 有失败原因组，但没有 `Failure Remediation Queue`。
- 修复项缺少优先级、建议动作或代表样本 ID。
- 没有失败原因组时仍展示误导性的修复队列。
- 原有趋势、洞察、失败聚类、Run 详情或 Run 对比不可用。

## 当前限制

- 队列由前端确定性规则生成，不持久化为任务。
- 不自动重跑 Regression Run。
- 不调用 LLM 生成修复建议。
- 不发送外部通知。

## 本轮验证证据

- `npm test -- --run src/pages/Evaluations.test.tsx`：13 项通过；覆盖失败原因组生成修复队列。
- 浏览器验收：本地登录后创建 Regression Sample Set，运行 Regression Run，评估中心展示 `Failure Remediation Queue` 与 1 个修复项。
- 截图：`.scratch/v0.10g-failure-remediation-queue.png`。
- 结果文件：`.scratch/v0.10g-browser-result.json`。
