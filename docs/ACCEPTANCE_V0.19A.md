# V0.19A Trace 链路索引验收

## 范围

V0.19A 在运行观测详情中增加只读 Trace 链路索引：

- 复用 `ObservabilityRunDetail` 已有字段，不新增后端接口。
- 按 `spanId` 聚合统一执行事件、人工任务和审计事件。
- 展示 root 运行级事件卡片。
- 展示每个节点 Span 的节点名称、类型、父 Span 和状态。
- 展示每个 Span 下的事件数、人工任务数和审计事件数。
- 保留原有执行事件流、节点执行链路、人工任务和审计事件区块。

## 验收证据

- RED 前端：`npx vitest run src/pages/Observability.test.tsx --reporter verbose -t "renders risk-first operations metrics and the selected run detail"` 首次失败，原因是缺少 `Trace 链路索引`。
- GREEN 前端主场景：同一命令通过。
- Observability 完整页面测试：`npx vitest run src/pages/Observability.test.tsx --reporter verbose --pool=forks --fileParallelism=false --testTimeout 15000` 通过，10 项测试。
- Observability 相关回归：`npx vitest run src/api/observability.test.ts src/pages/Observability.test.tsx --reporter verbose --pool=forks --fileParallelism=false --testTimeout 15000` 通过，2 个文件、15 项测试。
- 全量前端：`npm run test -- --run --pool=forks --fileParallelism=false --testTimeout 15000` 通过，33 个文件、132 项测试。
- `npm run lint` 通过。
- `npm run build` 通过，保留既有 Vite chunk-size warning。

## 浏览器验收

- 路由：`http://127.0.0.1:4173/w/ai-capability-center/observability?runId=4ac6b457-d0bd-4cf5-abd3-4d9cd5eb8854`。
- 页面显示 `Trace 链路索引`。
- 索引中显示 `root 运行级事件` 卡片，证据为事件 1、人工任务 0、审计事件 0。
- 索引中显示触发节点 Span，证据为事件 1、人工任务 0、审计事件 0。
- 索引中显示人工审核 Span，证据为事件 4、人工任务 1、审计事件 2。
- 浏览器控制台 warning/error 数量为 0。

## 非范围

- 不新增后端接口。
- 不修改 Trace / Span 生成逻辑。
- 不实现交互式图谱或拖拽画布。
- 不替换现有事件流和节点链路明细。

