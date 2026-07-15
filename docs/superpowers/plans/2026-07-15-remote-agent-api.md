# 远程 Agent API 实施计划

## 目标

删除 Python Package 产品入口，以 TDD 交付一个同步、结构化、受控的远程 Agent API 执行闭环，
同时保持内置 ModelGateway Agent、Run/NodeRun/Artifact 和 Workspace 隔离行为不回归。

## 步骤

1. **固定 Manifest 与 Gateway 契约**
   - 新增 `apps/api/app/agent_manifest.py` 和 `apps/api/app/agent_api_gateway.py`。
   - 先在 `apps/api/tests/test_agent_api_gateway.py`、`test_agent_runtime.py` 写 URL、Secret、幂等、响应与远程分派 RED 测试。
   - 验证：聚焦 Pytest 因模块/行为不存在失败。

2. **接入发布与执行链路**
   - 修改 `apps/api/app/schemas.py`、`main.py`、`execution.py`、`agent_runtime.py` 和测试支持注入。
   - 在 `test_agents_api.py`、`test_execution_api.py` 先写 Manifest 拒绝/冻结与远程运行持久化 RED 测试。
   - 验证：远程运行走 Fake Agent API Gateway，ModelGateway 调用数为零。

3. **替换前端产品入口**
   - 修改 `src/types.ts`、`src/pages/AgentDetail.tsx`、必要 CSS。
   - 先把 Package 测试替换为远程配置、校验、回填、切换与旧版迁移提示测试并确认 RED。
   - 验证：合法配置进入 PATCH；非法配置不发送请求；页面不存在 Package 输入/导入按钮。

4. **配置与文档**
   - 增加 `AGENT_API_ALLOWED_BINDINGS`（Workspace、Host、Secret Ref 三元绑定）与响应大小配置到后端示例、部署模板、安全和当前实现说明。
   - 更新 P0 Package 边界为“新配置已移除、历史版本失败关闭”，避免文档声称仍支持登记新 Package。

5. **完整验证与审查**
   - 聚焦后端、聚焦前端、后端全量、前端全量、`npm run lint`、`npm run build`、`npm run deploy:check`、`git diff --check`。
   - 浏览器验证执行方式切换、远程字段、旧 Package 迁移提示和发布后运行入口。
   - 在 Issue 记录 RED/GREEN、完整验证、第一性原理与对抗式审查证据。
