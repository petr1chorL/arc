# V0.9E 评估记录中心验收

## 这版做了什么

V0.9E 把 V0.9D 生成的 Evaluation 记录展示到评估中心页面，形成最小可用的评估历史工作台：

1. 评估中心加载 `GET /api/workspaces/{workspace_id}/evaluations/records`。
2. 页面新增“评估记录”区块。
3. 每条记录展示记录 ID、Rubric 快照名称、评估对象、Rubric 版本、总分、状态、维度分和评分说明。
4. 支持按状态筛选：全部、`passed`、`failed`。
5. 支持按 Rubric 筛选，包括当前 Rubric 和历史记录中引用的旧 Rubric。
6. 在 Rubric 配置弹窗运行评估成功后，新记录会即时插入历史列表。

## 人工验收路径

打开：

```text
http://127.0.0.1:4173/w/ai-capability-center/evaluations
```

### 1. 生成一条评估记录

1. 进入“评估中心”。
2. 找到任意 active Rubric 卡片。
3. 点击卡片右上角“配置量规”。
4. 在“运行评估”区域输入一段待评估产出物。
5. 点击“运行评估”。
6. 关闭弹窗或直接查看页面中部“评估记录”区。
7. 应看到刚生成的 Evaluation 记录，且记录 ID、总分、状态和维度分可见。

### 2. 验证状态筛选

1. 在“评估记录”区选择“状态筛选”。
2. 选择 `passed`。
3. 应只看到通过记录。
4. 选择 `failed`。
5. 如果当前没有失败记录，应看到空状态提示；如果已有失败记录，应只看到失败记录。

### 3. 验证 Rubric 筛选

1. 在“Rubric 筛选”中选择一个 Rubric。
2. 应只展示该 Rubric 产生的 Evaluation 记录。
3. 切回“全部 Rubric”，应恢复展示全部记录。

## 自动验证

```powershell
npm test -- src/pages/Evaluations.test.tsx src/api/evaluations.test.ts --run
apps\api\.venv\Scripts\python.exe -m pytest apps\api\tests -q
npm test -- --run
npm run lint
npm run build
```

## 边界说明

- 本版只做历史记录列表与筛选，不做批量评估任务。
- 本版不做评估记录详情页。
- 本版不做趋势图、对比图和回归报告。
- 历史记录使用运行时 Rubric 快照展示，后续 Rubric 修改不会影响旧记录。
