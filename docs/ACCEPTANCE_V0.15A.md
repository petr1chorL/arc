# V0.15A Provider 快照冻结验收说明

## 本版目标

V0.15A 让已发布 Agent 版本真正保持 Provider 依赖不可变：

- 发布 Agent 版本时，把 Provider 的 `secretRef` 标签冻结到版本快照的 `modelSecretRef`。
- 已发布版本运行时优先使用快照中的 `modelSecretRef`。
- Provider 后续编辑或停用不会改变旧版本运行使用的密钥引用标签。
- 如果 Provider 已停用，不能发布新的 Agent 版本。
- 仍然不保存、不返回、不展示原始 API Key。

## 验收方式

### 1. 发布快照包含 secretRef 标签

覆盖测试：

```text
apps/api/tests/test_agents_api.py::test_agent_can_bind_workspace_model_provider_asset
```

验收点：

- Agent 绑定 Provider 后发布版本。
- `published.snapshot.modelSecretRef` 等于发布时 Provider 的 `secretRef`。
- `published.snapshot` 不包含 `apiKey`。

### 2. Provider 后续变更不影响旧版本运行

覆盖测试：

```text
apps/api/tests/test_execution_api.py::test_agent_test_run_uses_published_provider_secret_ref_snapshot
```

验收点：

- Provider 发布时 `secretRef` 为 `DEEPSEEK_PUBLISHED_KEY`。
- 发布后把 Provider 更新为 `DEEPSEEK_ROTATED_KEY` 并停用。
- 运行旧 Agent 版本时，ModelGateway 收到的仍是 `DEEPSEEK_PUBLISHED_KEY`。
- 响应和网关调用中不包含 `apiKey`。

### 3. 已停用 Provider 不能发布新版本

覆盖测试：

```text
apps/api/tests/test_agents_api.py::test_agent_publish_rejects_disabled_bound_model_provider
```

验收点：

- Agent 先绑定 Provider。
- Provider 在发布前被停用。
- 发布 Agent 版本返回 `422`。
- 错误信息为“模型 Provider 已停用”。

## 自动化验证

本版完成后执行了以下检查：

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_agents_api.py::test_agent_can_bind_workspace_model_provider_asset apps/api/tests/test_agents_api.py::test_agent_publish_rejects_disabled_bound_model_provider apps/api/tests/test_execution_api.py::test_agent_test_run_uses_published_provider_secret_ref_snapshot -q
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_agents_api.py apps/api/tests/test_execution_api.py apps/api/tests/test_model_providers_api.py -q
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q
npm run lint
npm run build
```

结果：

- RED：快照缺少 `modelSecretRef`、发布未阻止已停用 Provider 时测试失败。
- GREEN：3 个新增/增强行为测试通过。
- 相关后端回归：28 项通过。
- 后端全量测试：通过。
- Lint：通过。
- Build：通过，保留既有 Vite chunk size warning。

## 尚未包含

- Provider 历史版本表。
- Provider 快照差异可视化。
- 对已发布 Agent 版本的一键废止或批量迁移。
