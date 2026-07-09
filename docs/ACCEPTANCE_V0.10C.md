# V0.10C Regression Run 对比验收

## 验收目标

确认评估中心可以选择两次 Regression Run，展示质量变化和样本级状态变化。

## 前置条件

- 已登录本地 ARC.ONE。
- 当前 Workspace 至少有两个 Regression Run。
- 如果没有两个 Run，可在评估中心使用同一个 Rubric 连续运行两次批量回归。

## 验收步骤

1. 打开 `http://127.0.0.1:4173/w/ai-capability-center/evaluations`。
2. 滚动到 `Regression Run History`。
3. 在 `基准 Run` 选择较早一次 Run。
4. 在 `目标 Run` 选择较新一次 Run。
5. 点击 `对比 Run`。
6. 确认出现 `Regression Run Comparison` 区块。
7. 确认区块展示：
   - 基准 Run ID。
   - 目标 Run ID。
   - 通过率变化。
   - 通过样本变化。
   - 失败样本变化。
   - 总样本变化。
8. 如果两次 Run 的样本状态不同，确认样本级变化可见，例如：
   - `失败变通过`。
   - `通过变失败`。
   - `持续失败`。
   - `新增失败`。

## 不通过判定

- 两个 Run 相同仍然可以点击对比。
- 对比后不展示差异摘要。
- 详情 API 失败时没有错误提示。
- 原有 `查看 Run 详情` 弹窗不可用。

## 当前限制

- V0.10C 只做两次 Run 的轻量对比。
- 暂不包含多 Run 趋势图、导出报告和后端聚合 API。
