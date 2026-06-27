# V0.9G 验收说明：轻量批量回归

## 这版做了什么

V0.9G 在评估中心增加了一个“批量回归”面板。它复用现有 Rubric 单条评估 API，让你一次输入多条样本，系统逐条评分，并展示通过率、失败样本和每条样本的得分。

## 用户验收路径

1. 打开本地站点并登录。
2. 进入 `评估中心`。
3. 找到 `批量回归` 区域。
4. 在 `回归 Rubric` 里选择一个可用 Rubric。
5. 在 `回归样本` 中输入多条样本，每行一条。
6. 点击 `运行批量回归`。

## 通过标准

- 页面显示 `批量回归` 面板。
- 未输入样本时点击运行，会出现必填错误。
- 有样本时，按钮进入运行状态。
- 运行完成后显示通过率、样本总数、通过数和失败数。
- 失败样本会在结果列表里显示为 `failed`。
- 每条样本都会生成一条 Evaluation 记录，并出现在 `评估记录` 列表。
- 点击评估记录的 `查看详情`，仍可查看 Rubric 快照、待评估产出物和维度得分。

## 当前边界

这版不是完整的回归任务系统。它没有新增后台任务表、定时调度、队列、重试、任务历史和批量样本集管理。

当前实现是“轻量批量运行器”：前端解析多条样本，顺序调用现有单条评估 API，每条样本独立沉淀为 Evaluation 记录。

## 自动化验收

已新增页面测试覆盖：

- 渲染 `批量回归` 区域。
- 输入两条样本并运行。
- 连续调用两次 Rubric 评估 API。
- 展示 `通过率 50%`、`2 条样本`、`1 条失败` 和失败样本。
- 校验请求体使用 `subjectType: regression_sample` 和 `sample-1` / `sample-2`。

真实浏览器验收已完成一次：临时账号运行两条样本，确定性评分器将两条都判为 `failed`，页面正确显示 `通过率 0%`、`2 条样本`、`2 条失败`，并保存截图到 `.scratch/v0.9g-batch-regression.png`。验收结束后已清理临时账号和对应 Evaluation 记录。

聚焦测试命令：

```powershell
npm test -- src/pages/Evaluations.test.tsx --run
```

完整验收命令：

```powershell
npm test -- src/pages/Evaluations.test.tsx src/api/evaluations.test.ts --run
apps\api\.venv\Scripts\python.exe -m pytest apps\api\tests -q
npm test -- --run
npm run lint
npm run build
```
