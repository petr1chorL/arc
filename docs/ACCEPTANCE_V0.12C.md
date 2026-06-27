# V0.12C 验收说明：HTTP Tool 执行链路后端切片

> 日期：2026-06-27

## 本版完成内容

V0.12C 后端切片把 Tool 资产从“只可登记与授权”推进到“可通过受控 Runtime 做测试调用，并在 Agent 执行时形成调用日志证据”。

- Tool / Skill 资产新增 `adapterType` 与 `adapterConfig`。
- `adapterType=http` 的 Tool 可通过 `POST /asset-library/{assetId}/test-invocations` 发起测试调用。
- HTTP 调用通过可注入 `HttpToolGateway` 执行，自动化测试使用 Fake Gateway。
- 默认网关为禁用状态，不会在未配置时主动访问外部网络。
- 成功测试调用会写入 `succeeded` 调用日志。
- 失败测试调用会写入 `failed` 调用日志，并只返回脱敏错误：`工具执行失败，请稍后重试`。
- 非 HTTP Tool 测试调用返回 422。
- Agent 绑定 HTTP Tool 后，直接测试运行会调用该 Tool。
- Agent 运行产生的 Tool 调用日志会带 `agentId`、`agentVersion`、`runId` 和 `nodeRunId`。
- HTTP Tool 输出摘要会作为工具调用结果补充进 Agent Runtime 输入。
- Tool 调用日志会派生成运行观测 `executionEvents`，并继承对应 NodeRun 的 Trace / Span。
- 旧 SQLite 表会自动补 `adapter_type` 与 `adapter_config` 字段。

## 没有完成的内容

这些仍属于 V0.12C 后续切片或 V0.12D：

- 真实外部 HTTP Gateway 的 allowlist、鉴权、超时和响应映射。
- MCP Server 适配。
- 前端 Tool / Skill 资产库管理页面。

## 自动化验收

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_tool_runtime_api.py -q
```

预期结果：

- 4 项通过。
- 覆盖成功调用日志、失败脱敏日志、非 HTTP Tool 422，以及 Agent 运行写入带上下文的工具调用日志。

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_observability_api.py::test_observability_run_detail_includes_tool_invocation_events -q
```

预期结果：

- 1 项通过。
- 覆盖 Tool 调用日志进入运行详情 `executionEvents`，并带 `tool_skill_invocation` source type 和 NodeRun span。

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_tool_runtime_api.py apps/api/tests/test_agent_runtime.py apps/api/tests/test_execution_api.py apps/api/tests/test_agent_lifecycle_api.py apps/api/tests/test_tool_skill_assets_api.py apps/api/tests/test_tool_skill_invocation_logs_api.py -q
```

预期结果：

- 23 项通过。
- 证明新增适配字段和 Agent 执行调用没有破坏资产库、调用日志、Agent Runtime、执行 API 和 Agent 发布校验。

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q
npm test -- --run
npm run lint
npm run build
```

预期结果：

- 后端全量 163 项通过。
- 前端 27 个测试文件、96 项测试通过。
- Oxlint 通过。
- TypeScript 编译与 Vite 生产构建通过。

## 人工验收建议

当前切片是后端能力，没有前端入口。人工验收可用 API 或测试作为准入：

1. 创建 `adapterType=http` 的 Tool。
2. 调用 `/asset-library/{assetId}/test-invocations`。
3. 查询 `/asset-library/invocations?assetId=...`。
4. 确认日志里出现同一个 invocation id、`inputSummary`、`outputSummary` 和状态。
