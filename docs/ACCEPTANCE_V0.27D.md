# V0.27D 验收记录：Artifact 节点级追溯锚点

## 范围

- Artifact 详情“查看运行链路”链接同时携带 `runId` 与 `nodeRunId`。
- Observability URL 带 `nodeRunId` 时，高亮对应节点 Span。
- Observability URL 带 `nodeRunId` 时，高亮对应 Trace 卡片。
- 用户手动切换 Run 时清除旧 `nodeRunId`。
- 现有 Artifact 详情、筛选 URL 和 Observability runId 深链接不回退。

## 验收结果

- RED：Artifact 链接测试期望 `nodeRunId` 后，实际链接仍只有 `runId`。
- RED：Observability 带 `nodeRunId=node-1` 时，对应节点 Span 未高亮。
- GREEN：Artifact 链接追加 `nodeRunId`，Observability 将 NodeRun ID 映射到 Span 并设置 active Span 后，聚焦测试通过。
- Artifact 聚焦测试：`1 passed`。
- Observability `nodeRunId` 聚焦测试：`1 passed`。
- Artifact 页面测试：`10 passed`。
- Observability 页面测试：`12 passed`。
- API / Layout / Artifact 相关回归：`17 passed`。
- `npm run lint`：通过。
- `npm run build`：通过；保留既有 Vite 大 chunk 警告。
- 浏览器验证：Playwright 打开 Artifact 详情，确认“查看运行链路”链接指向 `/w/ai-capability-center/observability?runId=run-2&nodeRunId=node-run-2`；关闭、清空、重新筛选并再次打开详情后链接仍正确。截图见 `.scratch/v0.26c-artifact-catalog-ui/browser-artifacts.png`。
- 备注：`Artifacts.test.tsx` 与 `Observability.test.tsx` 放在同一个 Vitest 命令中两次超时且无失败输出；拆分为稳定门禁后均通过。

## 验证命令

```powershell
npm run test -- src/pages/Artifacts.test.tsx -t "source run trace" --run
npm run test -- src/pages/Observability.test.tsx -t "nodeRunId" --run
npm run test -- src/pages/Artifacts.test.tsx --run
npm run test -- src/pages/Observability.test.tsx --run
npm run test -- src/api/artifacts.test.ts src/pages/Artifacts.test.tsx src/components/Layout.test.tsx --run
npm run lint
npm run build
$env:ARC_ONE_PORT='4201'; python C:\Users\a\.codex\skills\webapp-testing\scripts\with_server.py --server "npm run dev -- --host 127.0.0.1 --port 4201" --port 4201 -- node .scratch\v0.26c-artifact-catalog-ui\browser-check.mjs
```

## 覆盖场景

- Artifact 详情链接包含 `/observability?runId=run-1&nodeRunId=node-run-1`。
- Observability 初始 URL `/observability?runId=run-failed&nodeRunId=node-1` 会高亮 `span-agent`。
- 对应 Trace 卡片同步进入 active 状态。
- 当前 URL 参数展示中保留 `nodeRunId`。

## 尚未覆盖

- 不新增 Observability 后端 API。
- 不新增 NodeRun 独立详情页。
- 不高亮执行事件流中的单条事件。
