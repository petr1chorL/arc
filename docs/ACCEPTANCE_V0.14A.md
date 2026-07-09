# V0.14A 验收说明：Agent 运行配置入口

> 日期：2026-06-28

## 本版完成内容

V0.14A 为 Agent 草稿补齐第一版真实运行配置入口。

- Agent 后端契约新增 `modelProvider`、`modelBaseUrl`、`temperature`、`maxOutputTokens`。
- 新建 Agent 时运行配置有默认值：`openai-compatible`、空 Base URL、温度 `0.2`、最大输出 `2000`。
- Agent 详情页新增“运行配置”区块，可编辑模型 Provider、Base URL、温度和最大输出 Tokens。
- 保存草稿和发布前保存都会提交运行配置。
- 发布的不可变 Agent 版本快照包含运行配置。
- API 不接收、不返回、不发布 `apiKey` 字段；密钥仍只允许通过后端环境变量管理。

## 没有完成的内容

- 运行时尚未按 Agent 级 Base URL / temperature / maxOutputTokens 覆盖 ModelGateway。
- 运行配置还没有独立 Provider 资产库、连通性测试和密钥引用。
- 没有在 UI 中配置 API Key。
- 没有模型参数模板、成本预估和 Provider 健康检查。

## 自动化验收

### RED/GREEN 验证

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_agents_api.py::test_agent_runtime_configuration_is_saved_and_published_without_secrets -q
npx vitest run src/pages/AgentDetail.test.tsx -t "edits Agent runtime configuration" --reporter verbose
```

RED 结果：

- 后端首次失败，因为 Agent 响应缺少 `modelProvider`。
- 前端首次失败，因为 Agent 详情页没有“运行配置”区块。

GREEN 结果：

- 后端可保存、读取、发布运行配置，且响应与版本快照不包含 `apiKey`。
- 前端可编辑并保存 Provider、Base URL、温度和最大输出 Tokens，提交体不包含 `apiKey`。

### Focused 回归

```powershell
npx vitest run src/pages/AgentDetail.test.tsx src/components/AgentCreateDialog.test.tsx src/api/agents.test.ts --reporter verbose
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_agents_api.py apps/api/tests/test_v07a_migrations.py -q
```

实际结果：

- 前端 3 个测试文件、10 项测试通过。
- 后端 Agent API 与迁移相关测试通过。

### 全量回归

```powershell
$files = rg --files src | Where-Object { $_ -match '\.test\.(ts|tsx)$' }; npx vitest run @($files) --reporter verbose
npm run lint
npm run build
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q
```

实际结果：

- 前端全量 27 个测试文件、107 项测试通过。
- `npm run lint` 通过。
- `npm run build` 通过；仅保留既有 Vite chunk size warning。
- 后端完整测试集通过；仅保留既有 `StarletteDeprecationWarning`。

## 浏览器验收

页面：

```text
http://127.0.0.1:4173/w/ai-capability-center/agents
```

实际结果：

- 打开 Agent 详情页后可见“运行配置”区块。
- 可编辑并保存 `openai-compatible`、`https://api.deepseek.com`、`0.4`、`1600`。
- 刷新页面后四个字段仍从后端读回，证明已持久化。
- 浏览器控制台新增 warning/error 为 0。
- 截图：`.scratch/v0.14a-agent-runtime-config.png`。
- 验收结果：`.scratch/v0.14a-browser-result.json`。
