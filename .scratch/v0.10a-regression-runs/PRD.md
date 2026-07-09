# V0.10A PRD：Regression Run 历史

## 背景

V0.9H 已经可以保存 Golden Set，并在批量回归中选择样本集运行。但是当前批量回归结果只在页面即时展示，刷新页面后只能从 Evaluation 记录里间接查找，缺少一次“回归运行”的整体记录。

V0.10A 的目标是把批量回归沉淀为正式 Regression Run，让用户能看到每次回归的 Rubric、样本集、样本数量、通过率和关联 Evaluation 记录。

## 目标

1. 后端持久化每次批量回归运行。
2. 后端一次性执行样本集或手动样本的批量评估，并返回运行摘要与 Evaluation 记录。
3. 前端批量回归改为调用持久化运行 API。
4. 前端展示最近 Regression Run 历史。

## 非目标

- 不做后台队列。
- 不做定时回归。
- 不做异步运行状态轮询。
- 不做跨版本趋势分析。
- 不做 LLM-as-a-Judge。

## 用户故事

作为平台管理员，我希望每次批量回归都形成一条 Regression Run 记录，这样我能知道某个 Rubric 和 Golden Set 在某次改动后的通过率，而不是只能看零散 Evaluation 记录。

## 验收标准

1. `POST /evaluations/regression-runs` 可以创建一次批量回归运行。
2. 创建运行会生成一条 Regression Run 和多条 Evaluation 记录。
3. `GET /evaluations/regression-runs` 返回最近运行历史。
4. 前端批量回归运行后展示本次结果，并把运行插入历史列表。
5. 刷新页面后仍能看到历史运行。

