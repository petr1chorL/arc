# Agent Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现“创建 Agent，刷新或重启服务后仍可加载”的第一条真实端到端持久化路径。

**Architecture:** React 页面通过独立 API 客户端访问 FastAPI。FastAPI 使用 Pydantic 校验请求、SQLAlchemy 持久化领域记录；默认 SQLite 用于本地开发，环境变量可切换 PostgreSQL。

**Tech Stack:** React 19、TypeScript、Vitest、Testing Library、FastAPI、Pydantic、SQLAlchemy、Pytest、SQLite/PostgreSQL、Playwright

---

### Task 1: 建立前端测试底座

**Files:**
- Modify: `package.json`
- Modify: `vite.config.ts`
- Create: `src/test/setup.ts`

- [x] 安装 Vitest、Testing Library、jsdom 和 Playwright。
- [x] 增加 `test`、`test:watch`、`test:e2e` 脚本。
- [x] 配置 jsdom 与 jest-dom 匹配器。
- [x] 运行 `npm test -- --run`，确认测试运行器可用。

### Task 2: 先定义 Agent API 契约

**Files:**
- Modify: `src/types.ts`
- Create: `src/api/agents.test.ts`
- Create: `src/api/agents.ts`

- [x] 编写失败测试：列表请求映射 Agent 响应。
- [x] 运行测试，确认因 API 客户端不存在而失败。
- [x] 实现最小 `listAgents`，运行测试至通过。
- [x] 编写失败测试：创建请求发送最小字段并返回 Agent。
- [x] 实现 `createAgent` 和显式 HTTP 错误，运行测试至通过。

### Task 3: 建立 FastAPI 持久化 API

**Files:**
- Create: `apps/api/pyproject.toml`
- Create: `apps/api/app/config.py`
- Create: `apps/api/app/database.py`
- Create: `apps/api/app/models.py`
- Create: `apps/api/app/schemas.py`
- Create: `apps/api/app/main.py`
- Create: `apps/api/tests/test_agents_api.py`
- Modify: `.gitignore`

- [x] 创建 Python 虚拟环境并安装后端测试依赖。
- [x] 编写失败 API 测试：空字段返回 422。
- [x] 实现最小请求 Schema，运行测试至通过。
- [x] 编写失败 API 测试：创建后可读取稳定 ID 与时间戳。
- [x] 实现 SQLAlchemy 模型和 GET/POST 路由，运行测试至通过。
- [x] 增加应用重建后记录仍存在的回归测试。
- [x] 实现应用工厂与可注入数据库 URL，运行全部 API 测试。

### Task 4: 实现创建 Agent 界面

**Files:**
- Create: `src/components/AgentCreateDialog.test.tsx`
- Create: `src/components/AgentCreateDialog.tsx`
- Modify: `src/pages/Agents.tsx`
- Modify: `src/index.css`

- [x] 编写失败组件测试：空表单显示四个字段错误且不提交。
- [x] 实现最小表单校验，运行测试至通过。
- [x] 编写失败组件测试：合法输入调用创建回调。
- [x] 实现提交、禁用和服务端错误状态，运行测试至通过。
- [x] 编写失败页面测试：加载 API 列表并在创建成功后更新列表。
- [x] 将 Agent 页面改为 API 数据源，运行前端测试至通过。

### Task 5: 开发环境与 PostgreSQL 配置

**Files:**
- Modify: `vite.config.ts`
- Create: `compose.yaml`
- Create: `apps/api/.env.example`
- Modify: `README.md`

- [x] 配置 Vite `/api` 代理。
- [x] 增加 PostgreSQL Compose 服务和不含凭据的示例环境变量。
- [x] 补充前后端启动命令与 SQLite/PostgreSQL 切换说明。
- [x] 验证 API 可通过默认 SQLite 启动。

### Task 6: 端到端验证与项目记录

**Files:**
- Create: `e2e/agent-persistence.spec.ts`
- Create: `playwright.config.ts`
- Modify: `docs/CURRENT_IMPLEMENTATION.md`
- Modify: `.scratch/platform-foundation/issues/01-create-and-reload-agent.md`

- [x] 编写浏览器测试，覆盖创建后刷新重载。
- [x] 启动 API 与 Vite，运行浏览器测试至通过。
- [x] 重启 API，再次运行读取验证。
- [x] 运行 `npm test -- --run`、API pytest、`npm run lint`、`npm run build`。
- [x] 更新当前实现文档与 Issue 验收项，记录 Docker 未安装的验证限制。
- [x] 提交首个持久化纵向功能。
