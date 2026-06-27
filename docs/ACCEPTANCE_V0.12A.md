# V0.12A Agent Runtime 抽象验收记录

## 版本目标

建立第一版 Agent Runtime 合约，让 Agent 直接测试运行和工作流 Agent 节点通过同一协议执行，并统一返回输出、错误、Token、成本、评分、尝试次数、耗时和工具调用占位。

## 已实现能力

- 新增 `app.agent_runtime` 模块。
- 新增 `AgentRuntimeRequest`，描述 Workspace、Run、Node、Agent、Agent Version、输入、Prompt、模型、Tools 和 Skills。
- 新增 `AgentRuntimeResult`，描述状态、输出、脱敏错误、模型、Token、成本、评分、尝试次数、耗时和 `tool_calls` 占位。
- 新增 `AgentRuntimeExecutor`，负责模型调用、重试、成本计算、质量评分和错误脱敏。
- `ExecutionService.execute_agent` 改为调用 Runtime，并把 Runtime Result 映射到 `NodeRunRecord`。
- 现有 Agent 直接测试运行和工作流 Agent 节点继续保持 API 兼容。

## 验收命令

- RED：`apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_agent_runtime.py -q` 首次失败，原因是 `app.agent_runtime` 不存在。
- GREEN focused：`apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_agent_runtime.py apps/api/tests/test_execution_api.py::test_agent_test_run_records_model_usage_and_output apps/api/tests/test_execution_api.py::test_workflow_run_retries_and_persists_node_timeline -q`：4 条通过。
- 后端全量：`apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q`：全量通过。
- `npm run lint`：通过。
- `npm run build`：通过。

## 已知非阻断警告

- Pytest 仍有既有 `StarletteDeprecationWarning`。
- Vite build 仍有既有 chunk size warning。

## 后续

- V0.12B：Tool / Skill 资产库，把当前 Runtime `tool_calls` 占位连接到受控工具资产。
