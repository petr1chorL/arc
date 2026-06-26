# V0.8A 运行观测与异常排障验收

> 更新日期：2026-06-26

## 本轮交付

V0.8A 已经完成两个可运行的观测闭环：

1. 后端新增 Workspace 级观测概览 API。
2. 后端新增运行排障详情 API。
3. 前端新增“运行观测”导航入口和页面。
4. 页面展示总运行、失败运行、人工介入、恢复失败、平均耗时和模型成本。
5. 页面优先展示风险运行，并可点击最近运行查看节点链路、人工审核任务和审计事件。
6. 无运行数据时提示先发布并运行工作流。
7. 前端新增“人工 SLA 运营”区块。
8. 页面展示活跃任务、待认领、审核中、即将到期、已逾期、已升级和恢复失败。
9. 页面支持按 Reviewer 和审核组过滤 Human Task SLA 风险。
10. SLA 风险项可以跳转到人工审核页的对应任务。

## 页面入口

开发服务：

```text
http://127.0.0.1:4173
```

直接入口：

```text
http://127.0.0.1:4173/w/ai-capability-center/observability
```

侧栏入口名称：

```text
运行观测
```

## API

观测概览：

```text
GET /api/workspaces/{workspace_id}/observability/overview
```

运行排障详情：

```text
GET /api/workspaces/{workspace_id}/observability/runs/{run_id}
```

人工 SLA 运营：

```text
GET /api/workspaces/{workspace_id}/observability/human-sla
GET /api/workspaces/{workspace_id}/observability/human-sla?reviewerId={reviewer_id}
GET /api/workspaces/{workspace_id}/observability/human-sla?groupId={group_id}
```

两个接口都会走 Workspace 权限和资源隔离。

## 你验收时看什么

1. 左侧导航里能看到“运行观测”。
2. 进入页面后不是白屏，顶部标题是“运行观测”。
3. 指标区能看到总运行、失败运行、人工介入、恢复失败、平均耗时、模型成本。
4. 风险列表里优先出现等待审核、失败或恢复失败的运行。
5. 点击“最近运行”里的任意运行，右侧详情会切换。
6. 右侧详情能看到当前处理建议、输入/结果、节点执行链路、人工审核任务和审计事件。
7. “人工 SLA 运营”区块能看到活跃任务、待认领、审核中、即将到期、已逾期、已升级、恢复失败。
8. Reviewer 和审核组筛选器存在，并能刷新 SLA 风险列表。
9. SLA 风险项里的“进入人工审核页处理该任务”链接包含 `taskId` 参数。
10. 浏览器控制台没有 error。

## 已完成验证

```powershell
apps\api\.venv\Scripts\python.exe -m pytest apps\api\tests\test_observability_api.py -q
apps\api\.venv\Scripts\python.exe -m pytest apps\api\tests -q
npm test -- src/api/observability.test.ts
npm test -- src/pages/Observability.test.tsx
npm test -- src/api/observability.test.ts src/pages/Observability.test.tsx
npm test -- src/components/Layout.test.tsx
npm test -- --run
npm run lint
npm run build
```

浏览器验收：

- 打开 `http://127.0.0.1:4173/w/ai-capability-center/observability`。
- 页面成功渲染“运行观测”。
- 真实数据下风险状态显示为“等待审核”，没有历史乱码状态。
- 页面成功渲染“人工 SLA 运营”。
- Reviewer 和审核组筛选器可见。
- SLA 风险项可以跳到 `/reviews?taskId=...`。
- 浏览器日志无 error/warn。

## 未包含在本轮

- 状态和工作流名称筛选。
- 运行风险列表的状态和工作流名称筛选。
- 外部观测栈，例如 OpenTelemetry、Prometheus、Grafana。
- 主动告警通知。
- 成本治理详情页。

这些进入 V0.8A 后续小切片或 V0.8B。
