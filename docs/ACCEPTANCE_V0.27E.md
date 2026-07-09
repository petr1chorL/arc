# V0.27E 验收记录：NodeRun 执行事件流高亮

## 范围

- Observability URL 带 `nodeRunId` 时，对应节点 Span 仍会高亮。
- 对应 Trace 卡片仍会高亮。
- 执行事件流中同 `spanId` 的事件会高亮。
- 非匹配 Span 的事件不高亮。
- 现有 Trace 卡片点击定位能力不回退。

## 验收结果

- RED：新增事件流断言后，测试找不到 `执行事件 node-node-1`，事件 article 没有可测试标签和 active 状态。
- GREEN：`ExecutionEventStream` 接收 `activeSpanId`，给事件 article 增加 `aria-label` 和 active class 后，聚焦测试通过。
- Observability `nodeRunId` 聚焦测试：`1 passed`。
- Observability 页面测试：`12 passed`。
- API / Layout / Artifact 相关回归：`17 passed`。
- `npm run lint`：通过。
- `npm run build`：通过；保留既有 Vite 大 chunk 警告。
- 浏览器验证：Playwright 从 Artifact 详情点击“查看运行链路”进入 Observability，确认节点 Span、Trace 卡片和执行事件均进入 active 状态。截图见 `.scratch/v0.26c-artifact-catalog-ui/browser-artifacts.png`。

## 验证命令

```powershell
npm run test -- src/pages/Observability.test.tsx -t "nodeRunId" --run
npm run test -- src/pages/Observability.test.tsx --run
npm run test -- src/api/artifacts.test.ts src/pages/Artifacts.test.tsx src/components/Layout.test.tsx --run
npm run lint
npm run build
$env:ARC_ONE_PORT='4201'; python C:\Users\a\.codex\skills\webapp-testing\scripts\with_server.py --server "npm run dev -- --host 127.0.0.1 --port 4201" --port 4201 -- node .scratch\v0.26c-artifact-catalog-ui\browser-check.mjs
```

## 覆盖场景

- URL 带 `nodeRunId=node-1` 时，节点 `span-agent` 高亮。
- Trace 卡片 `span-agent` 高亮。
- 执行事件 `node-node-1` 高亮。
- 执行事件 `human-task-task-1` 不高亮。

## 尚未覆盖

- 不新增单条执行事件详情页。
- 不新增 root 运行级事件高亮。
- 不新增后端事件查询接口。
