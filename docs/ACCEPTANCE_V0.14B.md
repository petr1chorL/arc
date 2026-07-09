# V0.14B 验收说明：模型 Provider 资产入口

> 日期：2026-06-28

## 本版完成内容

V0.14B 把模型供应商配置从 Agent 草稿里进一步抽成 Workspace 级 Provider 资产。

- 后端新增 `model_providers` 表。
- Provider 保存 `name`、`providerType`、`baseUrl`、`defaultModel`、`secretRef` 和状态。
- API 接收误传的 `apiKey` 时会忽略，不保存、不返回、不写入列表。
- 新增 Provider 列表、创建和测试连接接口。
- 测试连接只检查后端环境变量中是否存在 `secretRef` 指向的密钥，不回显密钥值。
- 前端新增“模型 Provider”页面，可创建 Provider、查看 Provider 列表、测试连接。
- 页面只填写 `Secret Ref`，没有 API Key 输入框。

## 没有完成的内容

- Agent 草稿尚未通过下拉框选择 Provider 资产。
- Agent 运行时尚未按 Provider 资产覆盖 ModelGateway。
- 连通性测试当前只做密钥引用解析，不真实调用模型服务。
- 尚未提供 Provider 编辑、停用、默认 Provider、成本模板和模型列表同步。

## 自动化验收

### RED/GREEN 验证

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_model_providers_api.py -q
npx vitest run src/api/modelProviders.test.ts src/pages/ModelProviders.test.tsx --reporter verbose
```

RED 结果：

- 后端首次失败，因为 `POST /model-providers` 返回 404。
- 前端首次失败，因为 `src/api/modelProviders.ts` 和 `src/pages/ModelProviders.tsx` 不存在。

GREEN 结果：

- 后端可创建和列出 Provider，且响应不包含 `apiKey`。
- 后端测试连接在缺少环境变量时返回 `missing_secret`，不泄露密钥。
- 前端可创建 Provider、确认请求体不包含 `apiKey`，并展示连接测试结果。

### 回归验证

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_model_providers_api.py apps/api/tests/test_v07a_migrations.py -q
npx vitest run src/api/modelProviders.test.ts src/pages/ModelProviders.test.tsx --reporter verbose
$files = rg --files src | Where-Object { $_ -match '\.test\.(ts|tsx)$' }; npx vitest run @($files) --reporter verbose
npm run lint
npm run build
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q
```

结果：

- Provider 后端 focused 测试和迁移回归 8 项通过。
- Provider 前端 focused 测试 2 个测试文件、3 项通过。
- 前端完整测试 29 个测试文件、110 项通过。
- `npm run lint` 通过。
- `npm run build` 通过，保留既有 Vite chunk size warning。
- 后端完整测试集通过。

## 浏览器验收

页面：

```text
http://127.0.0.1:4173/w/ai-capability-center/settings/model-providers
```

- 成功打开“模型 Provider”页面。
- 创建 `DeepSeek V0.14B 验收 1782582819415` Provider。
- 页面没有 `API Key` 输入字段。
- 点击“测试连接”后展示 `密钥引用 DEEPSEEK_API_KEY 未在后端环境变量中配置`。
- 浏览器控制台新增 warning/error 数量为 0。
- 验收截图：`.scratch/v0.14b-model-providers.png`。
- 验收结果：`.scratch/v0.14b-browser-result.json`。
