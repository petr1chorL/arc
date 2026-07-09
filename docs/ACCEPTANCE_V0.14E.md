# V0.14E 验收说明：Provider secretRef 参与运行时解析

> 日期：2026-06-28

## 本版完成内容

V0.14E 让 Provider 的 `secretRef` 真正进入模型调用链路，同时仍不传递真实密钥值。

- Agent Runtime 新增 `modelSecretRef` 的内部传递字段。
- ExecutionService 会根据 Agent 版本快照里的 `modelProviderId` 查询当前 Workspace Provider。
- Runtime 只把 Provider 的 `secretRef` 标签传给 ModelGateway，不传真实 API Key。
- OpenAI-compatible ModelGateway 在外呼边界用 `secretRef` 解析后端环境变量。
- 若没有 Provider `secretRef`，ModelGateway 继续回退使用全局 `MODEL_API_KEY` 配置。
- Run 响应、NodeRun、Agent 快照和前端页面都不返回真实 API Key。

## 没有完成的内容

- 尚未支持 Provider 编辑/停用后的版本化依赖冻结。
- 尚未支持 Anthropic-compatible 真实协议适配。
- 尚未支持 Provider 成本模板和按 Provider 计费统计。

## 自动化验收

### RED/GREEN 验证

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_model_gateway.py::test_gateway_resolves_provider_secret_ref_at_call_boundary -q
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_execution_api.py::test_agent_test_run_passes_bound_provider_secret_ref_label_to_gateway -q
```

RED 结果：

- 网关首次失败，因为 `OpenAICompatibleGateway.complete()` 不接受 `model_secret_ref`。
- 执行链路首次失败，因为 FakeGateway 调用里没有 `model_secret_ref`。

GREEN 结果：

- 网关可在没有全局 key 时，通过 `model_secret_ref` 指向的环境变量构造 Authorization。
- Provider-bound Agent 运行时会把 `secretRef` 标签传给 FakeGateway，但响应里不包含 `secretRef` 或 `apiKey`。

### 回归验证

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_model_gateway.py apps/api/tests/test_agent_runtime.py -q
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_execution_api.py::test_agent_test_run_passes_published_runtime_config_to_gateway apps/api/tests/test_execution_api.py::test_agent_test_run_passes_bound_provider_secret_ref_label_to_gateway apps/api/tests/test_execution_api.py::test_agent_test_run_records_model_usage_and_output -q
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q
git diff --check
```

结果：

- ModelGateway / AgentRuntime focused 测试 4 项通过。
- Agent 直接运行 focused 测试 3 项通过。
- 后端完整测试集 190 项通过。
- `git diff --check` 通过，仅有 Windows 换行提示。
