# V0.10B PRD：Regression Run 详情与筛选

## 问题陈述

V0.10A 已经可以沉淀 Regression Run 历史，但历史卡片只能看摘要。用户无法从一次 Run 快速定位失败样本、查看关联 Evaluation 明细，也无法在历史较多时按 Rubric 或运行状态筛选。

## 解决方案

V0.10B 增加 Regression Run 详情读取 API、前端详情弹窗和轻量筛选能力，让用户能从历史摘要进入一次运行的样本级结果。

## 用户故事

作为 AI 能力平台管理员，我希望点击一次 Regression Run 后能看到每条样本的输入、得分、状态和评分说明，这样我能判断失败来自样本本身、Rubric 还是 Agent/Prompt 变更。

作为平台建设者，我希望能按 Rubric 和状态筛选 Regression Run 历史，这样在多个量规和多次回归之后仍能快速找到目标运行。

## 范围

1. 后端新增 `GET /evaluations/regression-runs/{run_id}`。
2. 详情 API 返回 Run 摘要和关联 Evaluation 记录。
3. 前端历史区支持按 Rubric 和状态筛选。
4. 点击历史卡片打开详情弹窗。
5. 详情弹窗展示样本级 Evaluation 记录。

## 范围外

- 不做后台异步轮询。
- 不做 Run 取消、重试或重新运行。
- 不做趋势图和跨 Run 对比。
- 不做 LLM-as-a-Judge。

## 验收标准

1. `GET /evaluations/regression-runs/{run_id}` 可以读取当前 Workspace 内的 Run 详情。
2. 访问其他 Workspace 或不存在的 Run 返回 404。
3. 前端可以按 Rubric 筛选 Regression Run 历史。
4. 前端可以按 `completed` / `failed` 等状态筛选 Regression Run 历史。
5. 点击 Run 历史卡片后打开详情弹窗，并展示样本级记录、分数、状态和评分说明。
6. 详情弹窗不影响已有批量回归、Evaluation 记录和 Rubric 管理功能。
