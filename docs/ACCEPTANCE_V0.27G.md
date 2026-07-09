# V0.27G 验收说明：Artifact 来源上下文

## 本版完成

- Artifact API 返回来源工作流与运行状态：`workflowName`、`runStatus`。
- Artifact API 返回来源节点上下文：`sourceNodeName`、`sourceNodeType`、`sourceNodeStatus`、`sourceNodeDurationMs`、`sourceNodeScore`。
- 历史 Artifact 缺少 NodeRun 时仍能返回，来源节点字段为 `null`。
- Artifact 列表卡片展示来源工作流与节点名称。
- Artifact 详情弹窗新增“来源上下文”，展示节点状态、耗时和得分。

## 验收方式

1. 打开 `/w/ai-capability-center/artifacts`。
2. 在 Artifact 卡片中确认能看到来源工作流名称和来源节点名称。
3. 点击“查看详情”。
4. 在详情弹窗确认出现“来源上下文”，且包含运行状态、节点类型、节点状态、节点耗时和节点得分。
5. 从详情点击“查看运行链路”，再从 Observability 节点点击“查看产出物”，确认双向跳转仍可用。

## 自动验证

- `apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_execution_api.py -k artifact`：2 项通过。
- `npm run test -- src/pages/Artifacts.test.tsx -t "source context" --run`：1 项通过。
- `npm run test -- src/api/artifacts.test.ts src/pages/Artifacts.test.tsx src/components/Layout.test.tsx --run`：20 项通过。
- `npm run test -- src/pages/Observability.test.tsx --run`：12 项通过。
- `npm run lint`：通过。
- `npm run build`：通过；存在 Vite chunk size 提醒，不影响构建结果。
- 浏览器验收：`with_server.py` 启动本地 Vite 后执行 `.scratch/v0.26c-artifact-catalog-ui/browser-check.mjs`，通过；截图在 `.scratch/v0.26c-artifact-catalog-ui/browser-artifacts.png`。

## 边界说明

- 本版不新增 Artifact 独立详情接口。
- 本版不做来源上下文筛选、排序、搜索、分页或导出。
- 缺少来源 Run / NodeRun 的旧数据会显示 ID 或“未知”，不阻断列表加载。
