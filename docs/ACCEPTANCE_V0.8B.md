# V0.8B 运行观测筛选与可分享视图验收

> 更新日期：2026-06-27

## 本轮目标

V0.8B 补齐运行观测页的筛选和 URL 可分享能力，让运营人员可以围绕某类异常运行快速定位、刷新和转交排障视图。

## 页面入口

```text
http://127.0.0.1:4173/w/ai-capability-center/observability
```

## 验收项

- 页面有运行状态、工作流名称和风险等级筛选器。
- 修改筛选器后，URL query 会同步更新。
- 刷新带 query 的 URL 后，筛选条件保留。
- 筛选后只展示匹配的风险运行和最近运行。
- 筛选无结果时展示“当前筛选无运行”。
- 点击风险卡片或最近运行后，URL query 会写入 `runId`。
- 浏览器控制台没有 error/warn。

## 自动化验证

```powershell
npm test -- src/pages/Observability.test.tsx
npm test -- --run
npm run lint
npm run build
```

已覆盖：

- 从 URL query 初始化筛选条件。
- 筛选后的运行列表不展示不匹配工作流。
- 筛选后自动加载匹配运行详情。
- 修改筛选器后同步 `status`、`workflow`、`risk` 和 `runId`。

## 浏览器验证记录

- 打开带 query 的观测页后，运行状态、工作流名称、风险等级筛选器按 URL 初始化。
- 真实数据库无匹配“价格”工作流时，页面展示“当前筛选无运行”。
- 切换到真实存在的“未命名工作流”后，列表恢复展示。
- 刷新页面后，`workflow` 与 `runId` 保留。
- 点击另一条最近运行后，URL 中的 `runId` 更新。
- 控制台 `warn/error` 日志为空。

## 范围外

- 不新增后端筛选接口。
- 不接 OpenTelemetry、Prometheus、Grafana、Loki、Tempo 或 Langfuse。
- 不做主动告警通知。
- 不做失败原因自动聚类。
