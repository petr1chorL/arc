# V0.27A 验收记录：Artifact 详情深链接

## 范围

- Artifact 实例页支持 `artifactVersionId` query 参数。
- URL 带 `artifactVersionId` 时，列表加载后自动打开对应 Artifact 详情。
- 点击“查看详情”后，地址栏写入 `artifactVersionId`。
- 关闭详情后，地址栏移除 `artifactVersionId`。
- 现有列表、筛选、Schema 状态和详情能力不回退。

## 验收结果

- RED：新增深链接页面测试后，带 `artifactVersionId` 的初始 URL 找不到详情弹窗。
- RED：新增 URL 同步测试后，点击“查看详情”不会写入 `artifactVersionId`。
- GREEN：接入 `useSearchParams`，用 query 参数驱动详情状态后，深链接聚焦测试通过。
- Artifact 页面测试：`7 passed`。
- 前端相关回归：`14 passed`。
- `npm run lint`：通过。
- `npm run build`：通过；保留既有 Vite 大 chunk 警告。
- 浏览器验证：Playwright 直接访问带 `artifactVersionId=artifact-version-2` 的 URL，确认详情自动打开；关闭后确认 query 被移除；再通过失败筛选打开详情，确认点击会重新写入 `artifactVersionId`。截图见 `.scratch/v0.26c-artifact-catalog-ui/browser-artifacts.png`。

## 验证命令

```powershell
npm run test -- src/pages/Artifacts.test.tsx -t "artifact detail" --run
npm run test -- src/pages/Artifacts.test.tsx --run
npm run test -- src/api/artifacts.test.ts src/pages/Artifacts.test.tsx src/components/Layout.test.tsx --run
npm run lint
npm run build
$env:ARC_ONE_PORT='4201'; python C:\Users\a\.codex\skills\webapp-testing\scripts\with_server.py --server "npm run dev -- --host 127.0.0.1 --port 4201" --port 4201 -- node .scratch\v0.26c-artifact-catalog-ui\browser-check.mjs
```

## 覆盖场景

- 初始 URL 自动打开 Artifact 详情。
- 点击详情同步地址栏 query。
- 关闭详情移除地址栏 query。
- 指向不存在 ArtifactVersion 的 query 不打断列表加载。
- 现有 Artifact 详情格式化内容和 Snapshot 展示继续通过。

## 尚未覆盖

- 不新增独立 `/artifacts/:id` 路由。
- 不新增后端详情 API。
- 不做复制到剪贴板。
- 不处理跨筛选条件自动补查缺失 Artifact。
