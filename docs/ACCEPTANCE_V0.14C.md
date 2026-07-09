# V0.14C 验收说明：Agent 绑定模型 Provider 资产

> 日期：2026-06-28

## 本版完成内容

V0.14C 第一块把 Agent 草稿的模型 Provider 从手填字符串升级为 Workspace 级 Provider 资产引用。

- 后端 Agent 新增 `modelProviderId` 字段。
- Agent 更新时会校验 Provider 必须存在于当前 Workspace。
- 绑定 Provider 后，Agent 会同步 Provider 类型、Base URL 和默认模型。
- 发布 Agent 版本时，快照会固化 `modelProviderId`、`modelProvider`、`modelBaseUrl` 和模型名称。
- 前端 Agent 详情页会加载 Workspace Provider 资产。
- “模型 Provider”控件改为下拉选择，不再要求用户手填 Provider 字符串。
- 页面和 API 仍不接收、不提交、不保存 `apiKey`。

## 没有完成的内容

- Agent 真实运行时尚未按 `modelProviderId` 动态创建 ModelGateway。
- Provider 密钥仍通过后端环境变量解析，前端不会填写 API Key。
- 尚未提供 Provider 编辑、停用和默认 Provider 策略。

## 自动化验收

### RED/GREEN 验证

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_agents_api.py::test_agent_can_bind_workspace_model_provider_asset -q
npx vitest run src/pages/AgentDetail.test.tsx --reporter verbose
```

RED 结果：

- 后端首次失败，因为 Agent 响应中没有 `modelProviderId`。
- 前端首次失败，因为页面没有名为“模型 Provider”的下拉框。

GREEN 结果：

- 后端可绑定 Provider 资产，未知 Provider ID 返回 404，发布快照固化 Provider 引用。
- 前端可选择 Provider 资产并保存草稿，PATCH 请求包含 `modelProviderId`，不包含 `apiKey`。

### 相关回归

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_agents_api.py apps/api/tests/test_model_providers_api.py apps/api/tests/test_v07a_migrations.py -q
npx vitest run src/pages/AgentDetail.test.tsx src/pages/ModelProviders.test.tsx src/api/agents.test.ts src/api/modelProviders.test.ts --reporter verbose
$files = rg --files src | Where-Object { $_ -match '\.test\.(ts|tsx)$' }; npx vitest run @($files) --reporter verbose
npm run lint
npm run build
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q
```

结果：

- 后端 Agent / Provider / 迁移相关测试 13 项通过。
- 前端 AgentDetail / ModelProviders / API wrapper 相关测试 4 个测试文件、11 项通过。
- 前端完整测试 29 个测试文件、111 项通过。
- `npm run lint` 通过。
- `npm run build` 通过，保留既有 Vite chunk size warning。
- 后端完整测试集 187 项通过。

## 浏览器验收

页面：

```text
http://127.0.0.1:4173/w/ai-capability-center/agents/12a525db-3e23-47c0-b840-d9b52409f3ff
```

- Agent 详情页显示“模型 Provider”下拉框。
- 下拉框可选择 `DeepSeek V0.14B 验收 1782582819415`。
- 保存草稿后刷新页面，Provider 选择仍然保持。
- `Base URL` 同步为 `https://api.deepseek.com`。
- `模型` 同步为 `deepseek-v4-pro`。
- 浏览器控制台新增 warning/error 数量为 0。
- 验收截图：`.scratch/v0.14c-agent-provider-binding.png`。
- 验收结果：`.scratch/v0.14c-browser-result.json`。
