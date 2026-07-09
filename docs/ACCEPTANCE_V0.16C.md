# V0.16C Agent Tool / Skill 资产绑定验收

## 本版完成

- Agent 详情页会读取当前 Workspace 的 Tool / Skill 资产库。
- Agent 详情页新增“可用 Tool 资产”和“可用 Skill 资产”选择区。
- active Tool / Skill 可勾选，保存后写入 Agent 草稿的 `tools` / `skills`。
- disabled Tool / Skill 可见但 checkbox 禁用，避免继续绑定停用资产。
- 原有 `Tools` / `Skills` 文本输入保留，用于兼容历史草稿和临时名称。
- 保存请求不包含 `apiKey` 字段。

## 自动化验证

- Page RED/GREEN：`npx vitest run src/pages/AgentDetail.test.tsx --reporter verbose`，1 个文件 5 项通过。
- Frontend related：`npx vitest run src/pages/AgentDetail.test.tsx src/pages/AssetLibrary.test.tsx src/api/assetLibrary.test.ts --reporter verbose`，3 个文件 12 项通过。
- Frontend full：`$files = rg --files src | Where-Object { $_ -match '\.test\.(ts|tsx)$' }; npx vitest run @($files) --reporter verbose`，31 个文件 127 项通过。
- Lint：`npm run lint` 通过。
- Build：`npm run build` 通过，保留既有 Vite chunk-size warning。
- Diff check：`git diff --check` 通过，仅有 Windows LF/CRLF 提示。

## 浏览器验收

- 页面：`http://127.0.0.1:4173/w/ai-capability-center/agents/12a525db-3e23-47c0-b840-d9b52409f3ff`
- 准备：在资产库创建 `V0.16C 浏览器 Tool` 和 `V0.16C 浏览器 Skill`，并复用 V0.16B 已停用的 `浏览器验收 Tool V2`。
- 操作：进入 Agent `test` 详情页，勾选 active Tool 与 active Skill，确认 disabled Tool checkbox 不可用，点击“保存草稿”。
- 结果：页面显示“草稿已保存”；disabled Tool 不可勾选；页面正文不包含 `apiKey`。
- Console：新增 warning/error 数为 0。

## 当前限制

- Agent API 仍以资产名称数组保存 `tools` / `skills`，尚未切换为稳定资产 ID 引用。
- 文本输入仍允许手动名称，后端继续负责最终资产存在性和启用状态校验。
- 本版不处理已发布 AgentVersion 的 Tool / Skill 资产迁移。
