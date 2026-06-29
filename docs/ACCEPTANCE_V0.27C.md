# V0.27C 验收记录：Artifact 运行链路入口

## 范围

- Artifact 详情弹窗展示“查看运行链路”入口。
- 入口链接到当前 Workspace 的 Observability 页面。
- 链接携带当前 Artifact 的 `runId` query 参数。
- 现有 Artifact 详情、详情深链接和筛选 URL 同步不回退。

## 验收结果

- RED：新增运行链路入口测试后，Artifact 详情弹窗找不到“查看运行链路”链接。
- GREEN：在详情弹窗头部增加运行链路链接后，聚焦测试通过。
- Artifact 运行链路聚焦测试：`1 passed`。
- Artifact 页面测试：`10 passed`。
- 前端相关回归：`17 passed`。
- `npm run lint`：通过。
- `npm run build`：通过；保留既有 Vite 大 chunk 警告。
- 浏览器验证：Playwright 打开带筛选和详情深链接的 Artifact 页面，确认“查看运行链路”链接指向 `/w/ai-capability-center/observability?runId=run-2`；关闭、清空、重新筛选并再次打开详情后，链接仍正确。截图见 `.scratch/v0.26c-artifact-catalog-ui/browser-artifacts.png`。

## 验证命令

```powershell
npm run test -- src/pages/Artifacts.test.tsx -t "run trace" --run
npm run test -- src/pages/Artifacts.test.tsx --run
npm run test -- src/api/artifacts.test.ts src/pages/Artifacts.test.tsx src/components/Layout.test.tsx --run
npm run lint
npm run build
$env:ARC_ONE_PORT='4201'; python C:\Users\a\.codex\skills\webapp-testing\scripts\with_server.py --server "npm run dev -- --host 127.0.0.1 --port 4201" --port 4201 -- node .scratch\v0.26c-artifact-catalog-ui\browser-check.mjs
```

## 覆盖场景

- 详情弹窗展示“查看运行链路”链接。
- 链接 `href` 为 `/w/ai-capability-center/observability?runId=run-1`。
- 详情弹窗已有格式化内容、Snapshot、Schema 状态、深链接和筛选 URL 测试继续通过。

## 尚未覆盖

- 不新增 Observability 页面能力。
- 不新增 NodeRun 级定位。
- 不新增 Artifact 独立详情 API。
