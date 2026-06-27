# V0.16A Tool / Skill 资产库前端入口验收

## 本版完成

- 新增前端 API wrapper：`src/api/assetLibrary.ts`。
- 新增 Tool / Skill 类型定义：`ToolSkillAsset`、`ToolSkillAssetCreateInput`、`ToolSkillInvocation`。
- 新增页面：`/w/:workspaceSlug/settings/asset-library`。
- 侧边栏新增“Tool / Skill”入口。
- 页面支持查看 Workspace 级 Tool / Skill 资产列表。
- 页面支持创建 `manual`、`http`、`mcp` 适配类型的 Tool / Skill 资产。
- 参数 Schema 与适配配置使用 JSON 文本输入，前端会在提交前校验。
- HTTP / MCP Tool 卡片支持填写测试参数并发起测试调用。
- 页面展示测试调用结果和最近调用日志。
- 页面不展示、不提交 `apiKey` 字段。

## 自动化验证

- Frontend focused：`npx vitest run src/api/assetLibrary.test.ts src/pages/AssetLibrary.test.tsx --reporter verbose`
- Backend related：`apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_tool_skill_assets_api.py apps/api/tests/test_tool_runtime_api.py apps/api/tests/test_tool_skill_invocation_logs_api.py -q`
- Frontend full：`$files = rg --files src | Where-Object { $_ -match '\.test\.(ts|tsx)$' }; npx vitest run @($files) --reporter verbose`
- Lint：`npm run lint`
- Build：`npm run build`
- Diff check：`git diff --check`

## 浏览器验收

- 页面：`http://127.0.0.1:4173/w/ai-capability-center/settings/asset-library`
- 操作：创建 `V0.16A MCP 验收 ...` MCP Tool，填写参数 Schema、适配配置和测试参数，执行测试调用。
- 结果：资产创建成功；测试调用完成；最近调用日志出现该资产；失败信息展示为脱敏文案“工具执行失败，请稍后重试”。
- Console：新增 warning/error 数为 0。
- 截图：`.scratch/v0.16a-tool-skill-library-ui.png`
- 结果 JSON：`.scratch/v0.16a-browser-result.json`

## 当前限制

- 暂不支持资产编辑、停用和版本化。
- 暂不支持 HTTP 鉴权头密钥托管。
- MCP Tool 仍是可注入网关骨架，默认不连接真实 MCP Server。
- 调用日志为页面内最近列表，尚未提供独立详情页、筛选和重放。
