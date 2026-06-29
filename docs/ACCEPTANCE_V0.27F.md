# V0.27F 验收说明：Observability 反向查看产出物

## 本版完成

- Artifact API 增加 `runId` 与 `sourceNodeRunId` 查询参数，可定位某次运行、某个节点运行产生的 ArtifactVersion。
- 前端 `listArtifacts` 支持拼接 `runId/sourceNodeRunId`，保留既有 Data Object 与 Schema 状态筛选。
- Artifact 页面支持从 URL 初始化 Run / NodeRun 筛选，并展示“当前筛选：Run：... / NodeRun：...”。
- Observability 运行详情的节点卡片新增“查看产出物”链接，指向对应 Artifact 目录筛选结果。

## 验收方式

1. 打开运行观测详情页，例如 `/w/ai-capability-center/observability?runId=<runId>&nodeRunId=<nodeRunId>`。
2. 在“节点执行链路”里找到对应节点卡片，点击“查看产出物”。
3. 页面应跳转到 `/w/ai-capability-center/artifacts?runId=<runId>&sourceNodeRunId=<nodeRunId>`。
4. Artifact 页面顶部应出现当前筛选提示，并且列表只展示该 Run / NodeRun 的产出物。
5. 点击“清空”后，Run / NodeRun 筛选应从 URL 和页面状态中移除。

## 自动验证

- `npm run test -- src/api/artifacts.test.ts -t "run and node run" --run`：通过。
- `npm run test -- src/pages/Artifacts.test.tsx -t "run lineage" --run`：通过。
- `npm run test -- src/pages/Observability.test.tsx -t "nodeRunId" --run`：通过。
- `npm run test -- src/api/artifacts.test.ts src/pages/Artifacts.test.tsx src/components/Layout.test.tsx --run`：19 项通过。
- `npm run test -- src/pages/Observability.test.tsx --run`：12 项通过。
- `apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_execution_api.py -k artifact`：2 项通过。
- `npm run lint`：通过。
- `npm run build`：通过；存在 Vite chunk size 提醒，不影响构建结果。
- 浏览器验收：`with_server.py` 启动本地 Vite 后执行 `.scratch/v0.26c-artifact-catalog-ui/browser-check.mjs`，通过；截图在 `.scratch/v0.26c-artifact-catalog-ui/browser-artifacts.png`。

## 边界说明

- 本版只做反向追溯入口和 URL 筛选，不新增 Artifact 专属详情 API。
- 若某个 NodeRun 没有产出物，跳转后会显示空列表，这是正常状态。
