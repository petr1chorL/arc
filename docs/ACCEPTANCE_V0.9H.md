# V0.9H 验收说明：Golden Set / 回归样本集

## 本版做了什么

V0.9H 把 V0.9G 的“临时粘贴多条样本做批量回归”升级为可保存、可复用的 Golden Set。

已经完成：

- 后端新增回归样本集表：`regression_sample_sets`。
- 后端新增回归样本表：`regression_samples`。
- 新增样本集列表 API。
- 新增样本集创建 API。
- 新增样本新增 API。
- 评估中心新增 `Regression Sample Sets` 面板。
- 可以在页面创建样本集、添加样本。
- 批量回归可以选择 Golden Set 运行 active 样本。
- 仍保留手动输入样本的临时回归方式。

## 你怎么验收

进入：

```text
http://127.0.0.1:4173/w/ai-capability-center/evaluations
```

### 1. 查看样本集面板

在评估中心找到 `Regression Sample Sets` 区块。

应看到：

- 样本集数量。
- 样本集列表。
- 创建样本集表单。
- 加入样本表单。

### 2. 创建样本集

填写：

- 样本集名称。
- 样本集说明。

点击“创建样本集”。

应看到：

- 新样本集出现在列表里。
- Golden Set 下拉框里也能选择该样本集。

### 3. 添加样本

选择刚创建的样本集，填写：

- 样本名称。
- 样本输入。
- 期望输出。
- 标签。

点击“加入样本”。

应看到：

- 样本集数量从 `0 / 0` 变成 `1 / 1`。
- 样本名称出现在样本集卡片里。

### 4. 用 Golden Set 跑批量回归

在“批量回归”区块：

- 选择可用 Rubric。
- Golden Set 选择刚创建的样本集。
- 点击“运行批量回归”。

应看到：

- 页面显示通过率。
- 每条样本显示评估分数、状态和 subjectId。
- 评估历史列表出现对应 Evaluation 记录。

## 本版不包含

- 定时回归。
- 后台队列。
- 回归任务历史。
- 样本导入导出。
- 样本版本对比。
- 真实 LLM-as-a-Judge。

## 自动化验证

本版至少需要通过：

```text
apps\api\.venv\Scripts\python.exe -m pytest apps\api\tests\test_evaluations_api.py -q
npm test -- --run src/pages/Evaluations.test.tsx
npm run lint
npm run build
```

浏览器验收截图：

```text
.scratch/v0.9h-golden-set.png
```

