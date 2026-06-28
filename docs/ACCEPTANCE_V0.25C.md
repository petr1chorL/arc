# V0.25C 验收记录：Data Object Definition 前端资产页

## 范围

- 新增前端 Data Object API Client：
  - `GET /api/workspaces/{workspaceId}/data-objects`
  - `POST /api/workspaces/{workspaceId}/data-objects`
  - `PATCH /api/workspaces/{workspaceId}/data-objects/{definitionId}`
  - `POST /api/workspaces/{workspaceId}/data-objects/{definitionId}/publish`
- 新增 `/w/:workspaceSlug/settings/data-objects` 页面。
- 侧边栏新增 `Data Object` 入口。
- 页面支持读取列表、创建 Definition、编辑 Definition、发布 Definition。
- 创建和编辑前会校验 Schema 必须是合法 JSON 对象。
- 卡片展示名称、描述、状态、版本、更新时间和 Schema 摘要。

## 验收结果

- RED：新增前端测试后，`src/api/dataObjects.ts` 和 `src/pages/DataObjects.tsx` 不存在，测试失败。
- GREEN：实现 API Client、页面、路由和导航后，聚焦前端测试通过。
- 浏览器验证：真实页面可加载 Data Object 列表，可拦截非法 JSON，可创建、编辑并发布到 `v1.0.0`。
- `npm run lint`：通过。
- `npm run build`：通过；保留既有 Vite 大 chunk 警告。

## 验证命令

```powershell
npx vitest run src/api/dataObjects.test.ts src/pages/DataObjects.test.tsx src/components/Layout.test.tsx --reporter verbose
npm run lint
npm run build
```

## 浏览器验证

验证脚本使用 Playwright 模拟登录、Workspace 和 Data Object API，打开：

```text
http://127.0.0.1:4189/w/ai-capability-center/settings/data-objects
```

验证结果：

- 页面标题和侧边栏 `Data Object` 入口可见。
- 初始 Definition `Product Brief` 可见。
- Schema 摘要 `required: asin` 可见。
- 非法 Schema JSON 会显示错误提示且不会创建。
- 合法 Schema JSON 可创建 `Review Output`。
- 可编辑为 `Review Decision Output`。
- 可发布并显示 `v1.0.0`。

截图证据：

```text
.scratch/v0.25c-data-object-library-ui/browser-data-objects.png
```

## 覆盖场景

- Data Object API Client 路径、方法和请求体。
- Data Object 页面初始列表加载。
- Schema JSON 非法时阻止创建。
- 创建成功后列表即时更新。
- 编辑成功后卡片即时更新。
- 发布成功后状态与版本即时更新。
- Layout 中 Data Object 导航链接进入当前 Workspace 路由。

## 尚未覆盖

- 不绑定工作流节点。
- 不展示版本历史抽屉。
- 不支持停用、删除或归档。
- 不做 Data Object 影响面分析。
- 不提供可视化 JSON Schema Builder。
- 不把运行 Artifact 实例改造成 Data Object 实例。
