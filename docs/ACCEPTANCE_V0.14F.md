# V0.14F Provider 生命周期验收说明

## 本版目标

V0.14F 补齐模型 Provider 的基础生命周期治理：

- 可以编辑 Provider 的非密钥配置：名称、类型、Base URL、默认模型、Secret Ref。
- 可以停用 Provider。
- 已停用 Provider 不能再被新的 Agent 草稿绑定。
- 前端、后端、测试和浏览器验收链路都不接收、不保存、不展示原始 API Key。

## 验收路径

### 1. 模型 Provider 页面可编辑

进入：

```text
/w/ai-capability-center/settings/model-providers
```

验收方式：

1. 找到一个 Provider 资产。
2. 点击“编辑”。
3. 修改名称或 Base URL / 默认模型 / Secret Ref。
4. 点击“保存”。
5. 页面显示“Provider 已更新”，资产列表展示更新后的名称。

浏览器验收证据：

- 截图：`.scratch/v0.14f-provider-lifecycle.png`
- 结果：`.scratch/v0.14f-browser-result.json`

### 2. 模型 Provider 可停用

验收方式：

1. 在同一个 Provider 资产上点击“停用”。
2. 页面显示“Provider 已停用”。
3. 资产状态变为 `disabled`。
4. “停用”按钮变为不可再次点击。

浏览器验收结果：

```json
{
  "updateSucceeded": true,
  "deactivateSucceeded": true,
  "disabledStatusVisible": true,
  "noApiKeyField": true,
  "consoleWarnOrErrorCount": 0
}
```

### 3. 停用 Provider 后不能再绑定 Agent

后端验收方式：

- 测试先创建 Provider。
- PATCH 更新 Provider。
- POST 停用 Provider。
- 再尝试把该 Provider 绑定到 Agent。
- API 返回 `422`，错误信息为“模型 Provider 已停用”。

覆盖测试：

```text
apps/api/tests/test_model_providers_api.py::test_model_provider_can_be_updated_deactivated_and_rejected_for_agent_binding
```

## 自动化验证

本版完成后执行了以下检查：

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q
$files = rg --files src | Where-Object { $_ -match '\.test\.(ts|tsx)$' }; npx vitest run @($files) --reporter verbose
npm run lint
npm run build
```

结果：

- 后端：191 项测试通过。
- 前端：29 个测试文件、113 项测试通过。
- Lint：通过。
- Build：通过，保留既有 Vite chunk size warning。

## 尚未包含

- Provider 历史版本快照。
- 已发布 Agent 版本对 Provider 后续编辑/停用的依赖冻结策略。
- Provider 级成本限额、调用配额和告警策略。
