# V0.19C Trace 链路定位验收

## 范围

V0.19C 在 V0.19A Trace 链路索引之上，把静态 Span 摘要升级为可点击的页面内排障目录。

## 已实现

- Trace 链路索引中的每个 Span 卡片新增“定位”按钮。
- 非 root Span 的定位按钮带有可访问名称，例如 `定位 Span span-agent`。
- 点击 Span 定位按钮后，页面会滚动到对应节点详情。
- 当前 Trace 卡片和对应节点详情会进入高亮状态。
- Root 运行级事件定位到执行事件流。

## 验收标准

- [x] Trace 链路索引的非 root Span 卡片提供“定位 Span ...”按钮。
- [x] 点击 Span 定位按钮后，对应节点详情调用 `scrollIntoView`。
- [x] 被定位的 Trace 卡片和节点详情有高亮状态。
- [x] root 运行级事件可以定位到执行事件流。
- [x] 现有 Trace 链路索引、执行事件流、节点链路内容不丢失。

## 验证证据

- RED：`npx vitest run src/pages/Observability.test.tsx --reporter verbose --pool=forks --fileParallelism=false --testTimeout 15000` 首次失败，原因是缺少 `定位 Span span-agent` 按钮。
- Focused：`npx vitest run src/pages/Observability.test.tsx --reporter verbose --pool=forks --fileParallelism=false --testTimeout 15000`，1 个文件 11 项通过。
- 前端全量：`npm run test -- --run --pool=forks --fileParallelism=false --testTimeout 15000`，33 个文件 134 项通过，保留既有 `--localstorage-file` warning。
- `npm run lint` 通过。
- `npm run build` 通过，保留既有 Vite chunk-size warning。
- 浏览器验收：运行观测详情页出现 `定位 Span span-3d459b29-10e3-4992-ab96-31412a41b875`；点击后 URL 不变，`Trace 卡片 Span ...` 和 `节点 Span ...` 均高亮，控制台 warning/error 为 0。
- 截图：`.scratch/v0.19c-trace-anchor-navigation.png`。

## 未实现

- 不提供多证据跳转菜单。
- 不改变 Trace / Span 聚合算法。
- 不新增路由、后端接口或持久化字段。
