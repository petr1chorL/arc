# V0.10F 失败样本聚类与原因摘要 PRD

## 问题陈述

V0.10E 能判断 Regression Run 的质量状态，但用户仍需要打开 Run 详情逐条查看失败样本，才能知道主要失败原因集中在哪里。

## 解决方案

在 `Regression Run Trend` 区域增加 `Failure Pattern Summary`，基于最新 Run 的失败 Evaluation 记录，按最低维度得分聚合失败样本，展示主要失败原因、样本数量、平均分和建议。

## 用户故事

- 作为质量负责人，我希望看到失败样本主要集中在哪些评分维度。
- 作为工作流构建者，我希望先处理数量最多的失败原因，而不是逐条翻样本。
- 作为运营人员，我希望知道最新 Run 的失败样本数量和代表样本 ID。

## 实施决策

- 只做前端确定性聚类，不新增后端 API。
- 只分析当前筛选后的最新 Regression Run。
- 每条失败记录归入最低 `dimensionScores.score` 对应的维度。
- 没有维度得分时归入“综合质量不足”。
- 最多展示 3 个原因组，按样本数降序。

## 测试决策

- 在 `src/pages/Evaluations.test.tsx` 增加红灯测试。
- 测试构造最新 Run 里的 3 条失败记录，其中 2 条 Evidence 最低、1 条 Actionability 最低。
- 验证页面展示 `Failure Pattern Summary`、失败样本总数、两个原因组、样本数和代表样本 ID。

## 范围外

- 不做 LLM 归因。
- 不跨多个 Run 做长期聚类。
- 不做样本详情展开和跳转。
- 不新增后端聚合接口。
