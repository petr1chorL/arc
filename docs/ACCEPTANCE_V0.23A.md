# V0.23A 工作流节点库拖拽入画布验收

V0.23A 补齐工作流编排中心的节点库拖拽能力。用户既可以继续点击节点库添加节点，也可以把节点拖到画布落点创建节点。

## 范围

- 节点库项增加浏览器拖拽语义。
- 画布接收来自节点库的拖拽释放。
- 释放时通过 React Flow 坐标转换计算新节点位置。
- 拖拽新增节点沿用现有工作流节点数据结构。
- 保存草稿时，拖拽新增节点进入原有工作流草稿请求体。

## 验收清单

- [x] 节点库项可拖拽。
- [x] 拖拽到画布释放后新增对应类型节点。
- [x] 新节点位置来自画布落点坐标转换。
- [x] 点击添加节点能力保持可用。
- [x] 保存草稿请求体包含拖拽新增节点。
- [x] 不新增后端接口，不改变工作流草稿契约。

## 自动化验证

- `npx vitest run src/pages/Workflows.test.tsx --reporter verbose --pool=forks --fileParallelism=false --testTimeout 15000`
  - 结果：通过，1 个文件、9 项测试通过。
- `npx vitest run src/pages/Workflows.test.tsx src/components/WorkflowNode.test.tsx --reporter verbose --pool=forks --fileParallelism=false --testTimeout 15000`
  - 结果：通过，2 个文件、11 项测试通过。
- `npx vitest run --pool=forks --fileParallelism=false --testTimeout 15000 --reporter verbose`
  - 结果：通过，33 个文件、160 项测试通过。
- `apps\api\.venv\Scripts\python.exe -m pytest apps/api/tests -q -ra`
  - 结果：通过，保留 1 条 Starlette TestClient 依赖弃用 warning。
- `npm run lint`
  - 结果：通过，无 lint warning。
- `npm run build`
  - 结果：通过；Vite 保留 chunk size warning。

## 浏览器验收

- 本地创建仅用于验收的 Workspace 管理员账号 `codex-acceptance@example.com`，不写入代码和文档密钥。
- 打开 `http://127.0.0.1:4173/w/ai-capability-center/workflows`，等待草稿数据稳定为“草稿已连接数据库”。
- 从左侧节点库拖拽“人工审核”到 React Flow 画布。
- 结果：画布节点数从 2 增加到 3，新增 1 个“人工审核”节点，节点库按钮 `draggable=true`。
- 截图证据：`.scratch/v0.23a-workflow-drag-palette/browser-drag-acceptance.png`。

## 修复记录

- 浏览器验收时发现新增节点可能因坏坐标或缺失 `kind` 导致 React Flow 白屏。
- 已补充节点坐标归一化：传给 React Flow 渲染和保存草稿的节点都会确保 `position.x/y` 是有限数字。
- 已补充 drop 坐标兜底：`screenToFlowPosition` 失败或拖拽事件坐标不可用时，回落到画布相对坐标或默认排布。
- 已补充 `WorkflowNode` 图标兜底：缺失或未知 `kind` 时不再渲染 undefined 组件。

## 非目标

- 不实现节点库拖拽预览图。
- 不实现框选、多选、分组、撤销或重做。
- 不改变后端工作流契约。
