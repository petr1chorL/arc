# V0.9A 评估资产概览验收

> 更新日期：2026-06-26

## 本轮交付

V0.9A 完成了评估中心的第一条真实数据链：

1. 后端新增评估资产概览 API。
2. API 统计反馈候选、待确认候选、已确认候选、Golden Sample、覆盖工作流和覆盖 Agent。
3. API 返回最近 5 条反馈候选摘要。
4. 前端新增评估 API 客户端。
5. 评估中心展示真实评估资产概览。
6. 评估中心保留原有 Rubric 展示，但顶部运营指标已改为真实 API 数据。
7. 无候选数据时展示清晰空状态。

## 页面入口

```text
http://127.0.0.1:4173/w/ai-capability-center/evaluations
```

侧栏入口：

```text
评估中心
```

## API

```text
GET /api/workspaces/{workspace_id}/evaluations/overview
```

该接口走 Workspace 权限和资源隔离。

## 你验收时看什么

1. 进入“评估中心”后，页面不是白屏。
2. 顶部能看到反馈候选、Golden Sample、覆盖工作流、待确认候选。
3. 页面中部能看到“评估资产概览”。
4. 如果当前没有人工修改候选，会显示空状态说明。
5. 如果完成一次“修改后通过”并由专家确认，最近候选会展示原因、状态和标签。
6. 页面下方仍能看到 Rubric 卡片。
7. 浏览器控制台没有 error/warn。

## 已完成验证

```powershell
apps\api\.venv\Scripts\python.exe -m pytest apps\api\tests\test_human_task_api.py::test_evaluations_overview_summarizes_feedback_and_golden_samples -q
npm test -- src/api/evaluations.test.ts src/pages/Evaluations.test.tsx
npm run lint
npm run build
```

浏览器验收：

- 打开 `http://127.0.0.1:4173/w/ai-capability-center/evaluations`。
- 页面成功渲染“评估资产概览”。
- 页面成功渲染“反馈候选”和“Golden Sample”。
- 当前本地数据为空时展示空状态。
- Rubric 卡片仍可见。
- 浏览器日志无 error/warn。

## 未包含在本轮

- Rubric 创建、编辑、发布和停用。
- Golden Sample 管理页。
- 回归测试任务。
- LLM-as-a-Judge。
- 评价器一致性校准。
