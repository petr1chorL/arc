# P0 Runtime Security Implementation Plan

> **Goal:** 封闭模型凭证外泄、Python Package 进程内执行和跨 Workspace AgentVersion 引用三条 P0 风险路径。

**Architecture:** 使用独立的运行时安全契约模块统一 Secret Ref 校验和历史清理；ModelGateway 在最终外呼边界执行 HTTPS/Host 守卫；AgentRuntime 对 Package Manifest fail closed；所有版本查询显式携带 Workspace ID。前端只提供安全契约对应的输入和状态。

**Tech Stack:** FastAPI, Pydantic, SQLAlchemy, httpx, pytest, React, TypeScript, Vitest.

---

## Task 1: 模型 Secret Ref 与出口守卫

**Files:**

- Create: `apps/api/app/runtime_security.py`
- Modify: `apps/api/app/config.py`
- Modify: `apps/api/app/model_gateway.py`
- Modify: `apps/api/app/main.py`
- Modify: `apps/api/tests/test_model_gateway.py`
- Modify: `apps/api/tests/test_model_providers_api.py`

### RED

1. 把现有“接受内联 Key”测试改为“拒绝内联值且不调用 HTTP”。
2. 新增未允许 Host、HTTP scheme、绑定 Provider 缺少 Secret Ref 不回退全局 Key 的测试。
3. 新增 Provider API 拒绝内联值且响应不回显的测试。
4. 运行：

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_model_gateway.py apps/api/tests/test_model_providers_api.py -q
```

预期：新增断言因当前兼容分支和缺少出口守卫而失败。

### GREEN

1. 新增 Secret Ref 格式函数和固定错误。
2. `Settings` 新增 `model_allowed_hosts`，默认 `api.deepseek.com`。
3. ModelGateway 在解析/发送凭证前校验 URL 与 Host。
4. 绑定 Provider 时要求合法且可解析的 Secret Ref；未绑定时才允许全局服务端 Key。
5. Provider 创建/更新端点在写库前执行固定错误校验。
6. 重跑聚焦测试并确认通过。

## Task 2: 历史凭证引用清理

**Files:**

- Modify: `apps/api/app/runtime_security.py`
- Modify: `apps/api/app/main.py`
- Create: `apps/api/tests/test_runtime_security.py`

### RED

1. 直接写入带无效 Secret Ref 的 Provider 与 AgentVersion 快照。
2. 断言清理后两个字段为空、合法环境变量引用保持不变。
3. 运行：

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_runtime_security.py -q
```

### GREEN

1. 实现不记录原值的幂等清理函数。
2. 在 `create_app` 初始化 Session 时调用并提交。
3. 重启同一测试数据库两次，确认清理幂等。

## Task 3: 禁用 Package 进程内执行

**Files:**

- Modify: `apps/api/app/agent_runtime.py`
- Modify: `apps/api/tests/test_agent_runtime.py`

### RED

1. 把 Package 成功执行测试改为工厂函数不得调用、结果为稳定失败。
2. 运行：

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_agent_runtime.py -q
```

### GREEN

1. 移除 Package 运行路径使用的 `Path`、`sys.path`、`import_module` 和 ChatOpenAI 构造。
2. Manifest 命中 Package 时直接返回一次失败结果。
3. 保留普通 ModelGateway Runtime 回归。

## Task 4: Workspace 版本守卫

**Files:**

- Modify: `apps/api/app/domain.py`
- Modify: `apps/api/app/execution.py`
- Modify: `apps/api/app/main.py`
- Modify: `apps/api/tests/test_workflow_lifecycle_api.py`
- Modify: `apps/api/tests/test_execution_api.py`

### RED

1. 在 Workspace A 发布 Agent，在 Workspace B 创建引用它的工作流。
2. 断言 B 的校验/发布失败。
3. 直接调用 ExecutionService，断言 B 的 Run 不能执行 A 的 AgentVersion。
4. 运行：

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_workflow_lifecycle_api.py apps/api/tests/test_execution_api.py -q
```

### GREEN

1. `validate_workflow` 的 AgentVersion 查询增加 `workspace_id`。
2. ExecutionService 的 AgentVersion/WorkflowVersion 查询全部增加 Workspace 条件。
3. 从 API 上下文或 Run 显式传递 Workspace ID。

## Task 5: 前端安全契约

**Files:**

- Modify: `src/pages/ModelProviders.tsx`
- Modify: `src/pages/AgentDetail.tsx`
- Modify: `src/pages/ModelProviders.test.tsx`
- Preserve user change: `src/pages/AgentDetail.test.tsx`

### RED

1. 新增 Secret Ref 只能填写环境变量名的文案和本地拦截测试。
2. 新增 Package “仅登记”提示及已发布 Package 版本禁用测试运行测试。
3. 运行：

```powershell
npm test -- --run src/pages/ModelProviders.test.tsx src/pages/AgentDetail.test.tsx
```

### GREEN

1. 去掉 “Secret Ref / Key” 和 `sk-...` 占位文案。
2. 提交前按同一格式校验 Secret Ref。
3. Package 区显示仅登记状态；含 Package 的发布版本禁用测试运行。

## Task 6: 文档与完成验证

**Files:**

- Modify: `docs/CURRENT_IMPLEMENTATION.md`
- Modify: `.scratch/p0-runtime-security/issues/*.md`
- Modify: `.scratch/p0-runtime-security/status.md`

1. 删除“Package 已可执行”和“内联 Key 可兼容”的错误描述，记录严格边界与范围外事项。
2. 运行聚焦测试后运行：

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q
npm test -- --run
npm run lint
npm run build
```

3. 使用本地浏览器验证模型资产和 Agent 详情两条路径。
4. 运行静态审计：

```powershell
rg -n "_looks_like_inline_api_key|sys\.path\.insert|import_module\(module_name\)|Secret Ref / Key|sk-\.\.\." apps/api/app src
```

预期：无命中。
5. 在 Issue 处理记录中写入本轮实际命令、结果和未解决风险；只有全部证据通过后才能完成。

