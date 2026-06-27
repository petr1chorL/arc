# V0.9B 评分量规资产验收

> 更新日期：2026-06-27

## 本轮交付

V0.9B 把评估中心下方的 Rubric 卡片从前端 mock 迁到了真实后端资产：

1. 新增 `rubrics` 数据表，用于保存 workspace 级评分量规。
2. 新增 Rubric API：`GET /api/workspaces/{workspace_id}/evaluations/rubrics`。
3. 首次访问 Rubric API 时，为当前 workspace 播种 3 个默认评分量规。
4. 重复访问不会重复创建默认 Rubric。
5. 前端 `Evaluations` 页面改为同时加载评估概览和 Rubric API。
6. Rubric 区域增加独立标题、可用数量、空态和错误提示。

## 页面入口

```text
http://127.0.0.1:4173/w/ai-capability-center/evaluations
```

## 你验收时看什么

1. 进入“评估中心”，页面不白屏。
2. 页面中部仍能看到“评估资产概览”和 Golden Sample 统计。
3. 页面下方能看到“评分量规”区域。
4. 至少能看到 3 张 Rubric 卡片。
5. 第一张卡片为“竞品分析质量标准”，并显示“竞品分析矩阵”。
6. 刷新页面后 Rubric 数量不会翻倍。
7. 浏览器控制台没有 error/warn。

## 已完成验证

```powershell
apps\api\.venv\Scripts\python.exe -m pytest apps\api\tests\test_evaluations_api.py -q
npm test -- src/api/evaluations.test.ts src/pages/Evaluations.test.tsx --run
apps\api\.venv\Scripts\python.exe -m pytest apps\api\tests -q
npm test -- --run
npm run lint
npm run build
```

浏览器验收：

- 使用本地 Playwright 登录临时验收账号并打开评估中心。
- 页面显示 3 张 Rubric 卡片。
- 页面显示“竞品分析质量标准”和“竞品分析矩阵”。
- 页面无 `role="alert"` 错误提示。
- 登录后控制台无 error/warn。
- 截图：`.scratch/v0.9b-evaluations-rubrics.png`。

## 未包含在本轮

- Rubric 创建、编辑、发布和停用。
- Rubric 不可变版本。
- Golden Set 管理页。
- 回归测试任务。
- LLM-as-a-Judge。
