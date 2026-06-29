# V0.27H 验收说明：Artifact 卡片直达运行链路

## 本版完成

- Artifact 列表卡片新增“查看运行链路”入口。
- 链接直接指向 `/observability?runId=<runId>&nodeRunId=<sourceNodeRunId>`。
- 原有“查看详情”入口继续可用。
- 详情弹窗中的“查看运行链路”入口继续保留。

## 验收方式

1. 打开 `/w/ai-capability-center/artifacts`。
2. 找到任意 Artifact 卡片。
3. 不打开详情，直接点击卡片上的“查看运行链路”。
4. 页面应进入 Observability，并定位到该 Artifact 的来源 Run / NodeRun。

## 自动验证

- RED：`npm run test -- src/pages/Artifacts.test.tsx -t "cards directly" --run` 首次失败，因为卡片没有运行链路入口。
- GREEN：同一命令通过，1 项通过。
- `npm run test -- src/api/artifacts.test.ts src/pages/Artifacts.test.tsx src/components/Layout.test.tsx --run`：21 项通过。
- `npm run test -- src/pages/Observability.test.tsx --run`：12 项通过。
- `npm run lint`：通过。
- `npm run build`：通过；存在 Vite chunk size 提醒，不影响构建结果。
- 浏览器验收：`with_server.py` 启动本地 Vite 后执行 `.scratch/v0.26c-artifact-catalog-ui/browser-check.mjs`，通过；截图在 `.scratch/v0.26c-artifact-catalog-ui/browser-artifacts.png`。

## 边界说明

- 本版不新增后端 API。
- 本版不改变详情弹窗中的运行链路入口。
- 本版不新增批量跳转或新窗口打开行为。
