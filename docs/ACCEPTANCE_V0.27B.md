# V0.27B 验收记录：Artifact 筛选 URL 同步

## 范围

- Artifact 实例页支持从 URL 读取 `dataObjectDefinitionId` 与 `schemaValidationStatus`。
- 初始 URL 带筛选参数时，筛选控件与 API 请求保持一致。
- 点击“筛选”后，把当前筛选条件写入地址栏。
- 点击“清空”后，只移除筛选参数，保留 `artifactVersionId` 等其他 query。
- 现有 Artifact 详情深链接、Schema 状态展示和列表筛选不回退。

## 验收结果

- RED：新增初始 URL 筛选测试后，页面仍请求未筛选列表，找不到筛选后的 Artifact。
- RED：新增筛选 URL 同步测试后，点击“筛选”不会写入 query，点击“清空”也无法验证保留详情参数。
- GREEN：用 `useSearchParams` 初始化筛选状态，并在筛选/清空动作中同步 query 后，新增 URL 筛选测试通过。
- Artifact 筛选聚焦测试：`2 passed`。
- Artifact 页面测试：`9 passed`。
- 前端相关回归：`16 passed`。
- `npm run lint`：通过。
- `npm run build`：通过；保留既有 Vite 大 chunk 警告。
- 浏览器验证：Playwright 直接访问带 `dataObjectDefinitionId=data-object-1&schemaValidationStatus=failed&artifactVersionId=artifact-version-2` 的 URL，确认筛选控件初始化、详情自动打开、关闭详情保留筛选参数、清空移除筛选参数、重新筛选后打开详情保留所有 query。截图见 `.scratch/v0.26c-artifact-catalog-ui/browser-artifacts.png`。

## 验证命令

```powershell
npm run test -- src/pages/Artifacts.test.tsx -t "artifact filters" --run
npm run test -- src/pages/Artifacts.test.tsx --run
npm run test -- src/api/artifacts.test.ts src/pages/Artifacts.test.tsx src/components/Layout.test.tsx --run
npm run lint
npm run build
$env:ARC_ONE_PORT='4201'; python C:\Users\a\.codex\skills\webapp-testing\scripts\with_server.py --server "npm run dev -- --host 127.0.0.1 --port 4201" --port 4201 -- node .scratch\v0.26c-artifact-catalog-ui\browser-check.mjs
```

## 覆盖场景

- 初始 URL 中的 Data Object Definition ID 会填入输入框，并用于 Artifact API 请求。
- 初始 URL 中的 Schema 校验状态会选中对应下拉项，并用于 Artifact API 请求。
- 点击“筛选”写入 `dataObjectDefinitionId` 与 `schemaValidationStatus`。
- 点击“清空”移除筛选 query，同时保留 `artifactVersionId`。
- 现有 Artifact 详情深链接测试继续通过。

## 尚未覆盖

- 不新增后端 API。
- 不新增分页、排序或高级查询表达式。
- 不把筛选状态写入数据库或 localStorage。
- 不为非法 `schemaValidationStatus` 做前端错误提示；当前回退为“全部”。
