# V0.9D Rubric 评估运行验收

## 这版做了什么

V0.9D 把 Rubric 从“评分标准资产”推进到“可运行评估”：

1. 新增 `evaluations` 数据表。
2. 新增评估运行 API：`POST /api/workspaces/{workspace_id}/evaluations/rubrics/{rubric_id}/evaluate`。
3. 新增评估记录列表 API：`GET /api/workspaces/{workspace_id}/evaluations/records`。
4. Rubric 配置弹窗增加“运行评估”区。
5. 评估记录保存 Rubric 快照、版本、产出物文本、维度分、总分、状态和说明。
6. draft / disabled Rubric 不允许运行评估。

## 人工验收路径

打开：

```text
http://127.0.0.1:4173/w/ai-capability-center/evaluations
```

### 1. 运行一次评估

1. 进入“评估中心”。
2. 找到一张 active Rubric 卡片。
3. 点击卡片右上角“配置量规”按钮。
4. 在“运行评估”区域的“待评估产出物”里输入一段文本。
5. 点击“运行评估”。
6. 应看到“总分 xx”、`passed` 或 `failed` 状态，以及每个维度的分数。

### 2. 检查记录可追溯

用 API 或浏览器网络面板检查响应：

- `rubricId` 为当前 Rubric。
- `rubricVersion` 为当前可用版本。
- `rubricSnapshot` 包含运行时使用的 Rubric 快照。
- `dimensionScores` 包含每个维度的名称、权重和得分。

### 3. 检查禁用逻辑

1. 新建一个 Rubric 草稿但不发布。
2. 直接运行评估，应返回 409。
3. 停用一个 Rubric。
4. 再运行评估，应返回 409。

## 自动验证

```powershell
apps\api\.venv\Scripts\python.exe -m pytest apps\api\tests\test_evaluations_api.py -q
npm test -- src/api/evaluations.test.ts src/pages/Evaluations.test.tsx --run
npm run lint
npm run build
```

## 边界说明

- 本版评分器是确定性评分器，用来验证链路，不代表最终 LLM-as-a-Judge。
- 本版不做批量评估、回归任务或评估集管理。
- 本版不接 Langfuse、DeepEval、Ragas。
