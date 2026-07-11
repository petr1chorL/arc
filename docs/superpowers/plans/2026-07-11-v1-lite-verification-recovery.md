# V1.0 Lite Verification Recovery Implementation Plan

## Goal

恢复 Python 3.12、标准 build 和登录后 Playwright，使 V1 Lite 核心路径具备可重复新证据。

## Task 1：Python 3.12 环境

- 将损坏的 Python 3.14 `apps/api/.venv` 隔离备份。
- 用 Python 3.12 重建并安装 `apps/api[test]`。
- 验证解释器版本和聚焦后端测试。

## Task 2：隔离 E2E API 入口

Files:

- Create: `apps/api/app/e2e_server.py`
- Create: `apps/api/tests/test_e2e_server.py`

RED：测试唯一数据库和非生产环境生成，确认模块尚不存在。

GREEN：实现隔离环境、bootstrap，并在同一 Python 进程启动 Uvicorn。

## Task 3：Playwright 登录路径

Files:

- Modify: `playwright.config.ts`
- Create: `e2e/global-setup.ts`
- Modify: `e2e/agent-persistence.spec.ts`

RED：当前 webServer 因根 `.venv` 损坏失败。

GREEN：由 Playwright `globalSetup` 启停隔离 API 与 Vite；两条用例先登录，再验证 Agent
持久化和 WorkflowVersion 引用。

## Task 4：完整验证与文档

运行：

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q
npm test -- --run
npm run lint
npm run build
npm run deploy:check
npm run test:e2e
git diff --check
```

通过后更新 Issue、状态、当前项目状态、源码盘点和 V1 Lite 验收阻断项。自动测试通过不勾选
业务方签收项。
