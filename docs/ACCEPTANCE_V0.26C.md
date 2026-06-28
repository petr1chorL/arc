# V0.26C 验收记录：Artifact 实例页

## 范围

- 新增前端 API client：`listArtifacts(workspaceId, filters)`。
- 新增 Workspace 路由：`/w/:workspaceSlug/artifacts`。
- 主导航新增“产出物”入口。
- 页面展示 ArtifactVersion 数量、Data Object 绑定数量、平均得分、运行来源、来源 NodeRun、Data Object Definition ID、Data Object Version ID、Schema 摘要和内容预览。
- 页面支持按 Data Object Definition ID 筛选。

## 验收结果

- RED：API client 测试因缺少 `src/api/artifacts.ts` 失败。
- RED：页面测试因缺少 `src/pages/Artifacts.tsx` 失败。
- RED：Layout 测试找不到“产出物”导航入口。
- GREEN：新增 API client、页面、路由和导航后，聚焦测试通过。
- 相关前端回归测试：`8 passed`。
- Data Object 前端回归测试：`4 passed`。
- `npm run lint`：通过。
- `npm run build`：通过；保留既有 Vite 大 chunk 警告。
- 浏览器验证：Playwright 打开 `/w/ai-capability-center/artifacts`，mock 登录态和 Artifact API，确认页面标题、Data Object 版本和内容预览可见；截图见 `.scratch/v0.26c-artifact-catalog-ui/browser-artifacts.png`。

## 验证命令

```powershell
npm run test -- src/api/artifacts.test.ts --run
npm run test -- src/pages/Artifacts.test.tsx --run
npm run test -- src/components/Layout.test.tsx -t "links to artifact instances" --run
npm run test -- src/api/artifacts.test.ts src/pages/Artifacts.test.tsx src/components/Layout.test.tsx --run
npm run test -- src/pages/DataObjects.test.tsx src/api/dataObjects.test.ts --run
npm run lint
npm run build
node .scratch/v0.26c-artifact-catalog-ui/browser-check.mjs
```

## 覆盖场景

- Artifact API client 发送 `dataObjectDefinitionId` 查询参数。
- 页面展示 Artifact 内容和 Data Object 版本。
- 页面展示 Run ID、NodeRun ID、得分和 Schema 摘要。
- 用户输入 Definition ID 后点击“筛选”，页面重新请求过滤后的 API。
- 主导航“产出物”指向当前 Workspace。

## 尚未覆盖

- 不提供 Artifact 详情页。
- 不做完整 JSON 结构化渲染或 Schema 校验。
- 不支持分页游标、导出、全文搜索。
- 不从 Data Object Definition 列表生成下拉筛选。
