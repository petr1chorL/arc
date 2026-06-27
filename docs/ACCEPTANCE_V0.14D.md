# V0.14D 验收说明：Runtime 使用 Agent 运行配置

> 日期：2026-06-28

## 本版完成内容

V0.14D 让已发布 Agent 版本中的非密钥运行配置进入真实 Runtime 调用链路。

- `AgentRuntimeRequest` 新增 Provider ID、Provider 类型、Base URL、温度和最大输出 Tokens。
- `ExecutionService` 从 Agent 版本快照读取这些字段，并传入 Agent Runtime。
- `AgentRuntimeExecutor` 调用 ModelGateway 时携带这些非密钥运行配置。
- `OpenAICompatibleGateway` 会使用 Agent 快照中的 Base URL、温度和最大输出 Tokens 覆盖默认请求参数。
- Runtime 仍不会从前端、数据库或响应中读取/返回 API Key。

## 没有完成的内容

- 本版尚未按 Provider 的 `secretRef` 动态解析不同 API Key。
- 本版尚未支持 Anthropic-compatible 真实协议适配。
- Provider 成本模板、默认 Provider、编辑/停用策略仍未实现。

## 自动化验收

### RED/GREEN 验证

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_execution_api.py::test_agent_test_run_passes_published_runtime_config_to_gateway -q
```

RED 结果：

- 首次失败，因为 FakeGateway 调用记录中缺少 `model_provider_id`、`model_provider`、`model_base_url`、`temperature` 和 `max_output_tokens`。

GREEN 结果：

- Agent 直接运行时，FakeGateway 收到发布快照里的模型、Base URL、温度和最大输出 Tokens。

### 回归验证

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_agent_runtime.py apps/api/tests/test_model_gateway.py -q
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_execution_api.py::test_agent_test_run_records_model_usage_and_output apps/api/tests/test_execution_api.py::test_agent_test_run_passes_published_runtime_config_to_gateway -q
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q
git diff --check
```

结果：

- Runtime / ModelGateway focused 测试 3 项通过。
- Agent 直接运行 focused 测试 2 项通过。
- 后端完整测试集 188 项通过。
- `git diff --check` 通过，仅有 Windows 换行提示。
