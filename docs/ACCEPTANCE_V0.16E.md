# V0.16E 验收说明：运行时稳定 Tool 引用

## 本版做了什么

V0.16E 把 V0.16D 保存到 Agent 发布快照里的 `toolAssetRefs` 接入运行时。

- Agent test run 和工作流 Agent 节点调用 HTTP Tool 时，优先使用发布快照中的 Tool 资产 ID。
- Tool 发布后改名，已发布 Agent 版本仍能调用发布时绑定的 Tool 资产。
- 没有 `toolAssetRefs` 的旧版本快照继续按 `tools` 名称数组查找，保持兼容。
- Prompt 中展示的 Tool / Skill 名称优先来自发布快照引用，减少运行时上下文漂移。

## 如何验收

运行：

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_tool_runtime_api.py::test_agent_test_run_invokes_http_tool_by_published_asset_ref_after_rename apps/api/tests/test_tool_runtime_api.py::test_agent_test_run_falls_back_to_legacy_tool_names_without_asset_refs -q
```

预期：

- Tool 改名后，HTTP Tool gateway 仍被调用。
- Tool 调用日志能通过原资产 ID 查到。
- 模型输入包含 Tool 调用结果摘要。
- 旧快照没有 `toolAssetRefs` 时仍能按名称调用 HTTP Tool。

## 当前验收状态

- RED：已确认改名后运行时没有调用 Tool，失败点为 `tool_gateway.calls == []`。
- GREEN：已确认稳定引用 focused 测试通过。
- 旧快照兼容：已确认名称兜底 focused 测试通过。
- 相关后端回归：`test_tool_runtime_api.py`、`test_tool_skill_assets_api.py`、`test_execution_api.py` 共 36 项通过。
- 全量验证：已通过后端全量 pytest、前端 Vitest、lint、build 和 diff check。

## 边界说明

本版只接入 HTTP Tool 的运行时稳定引用。MCP Tool 仍保持测试调用能力，Agent 运行时自动 MCP 调用不在本版范围内。
