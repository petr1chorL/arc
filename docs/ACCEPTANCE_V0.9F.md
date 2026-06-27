# V0.9F 评估记录详情验收

## 这版做了什么

V0.9F 在 V0.9E 的评估记录列表上增加只读详情查看：

1. 每条 Evaluation 记录新增“查看详情”按钮。
2. 详情弹窗展示记录 ID、总分、状态和创建时间。
3. 展示评估对象类型和对象 ID。
4. 展示运行时 Rubric 快照：名称、版本、适用产出物、硬性门禁和通过阈值。
5. 展示每个评分维度的权重和得分。
6. 展示待评估产出物原文和评分说明。

## 人工验收路径

打开：

```text
http://127.0.0.1:4173/w/ai-capability-center/evaluations
```

### 1. 生成或找到一条评估记录

1. 进入“评估中心”。
2. 如果“评估记录”为空，先打开任意 active Rubric 的配置弹窗。
3. 输入一段待评估产出物并点击“运行评估”。
4. 回到“评估记录”区。

### 2. 查看评估详情

1. 点击评估记录卡片上的“查看详情”。
2. 应看到“评估详情”弹窗。
3. 弹窗中应包含：
   - Evaluation 记录 ID。
   - 总分和 `passed` / `failed` 状态。
   - 评估对象。
   - Rubric 快照。
   - 维度权重与维度得分。
   - 待评估产出物原文。
   - 评分说明。

### 3. 关闭详情

1. 点击右上角关闭按钮。
2. 弹窗关闭，回到评估中心。

## 自动验证

```powershell
npm test -- src/pages/Evaluations.test.tsx src/api/evaluations.test.ts --run
apps\api\.venv\Scripts\python.exe -m pytest apps\api\tests -q
npm test -- --run
npm run lint
npm run build
```

## 边界说明

- 本版不新增评估记录详情 API，直接复用列表 API 已返回的数据。
- 本版详情为只读，不支持编辑、删除或重新评分。
- 本版不做评估记录对比、趋势图和批量回归任务。
