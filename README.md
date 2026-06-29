# ARC.ONE Agentic OS

面向企业 AI 工作流设计、执行、评估、人工协作和运行治理的平台。

## 当前状态

当前版本已完成 Agent、Workflow、Human Review、Evaluation、Observability、Tool/Skill、Model Provider、Notification Outbox 等核心闭环的可运行原型。当前推进策略已调整为 **V1.0 Lite：先让一个真实业务团队跑通试点**。

已实现：

- 运营总览
- 工作流 DAG 编排
- Agent 资产管理
- Rubric 与质量门禁
- 运行实例追踪
- 人工审核工作台
- 桌面端和移动端适配
- 创建 Agent、字段校验和错误反馈
- FastAPI Agent 列表/创建 API
- SQLite 本地持久化
- PostgreSQL Compose 配置
- Vitest、Testing Library 和 Pytest 自动化测试
- Agent 详情、编辑、System Prompt、Tool/Skill 配置
- Agent 不可变版本发布、版本历史和停用
- 工作流创建、节点配置、草稿保存和刷新重载
- 工作流 DAG 与 Agent 版本引用校验
- 工作流不可变版本发布和版本历史

V1.0 Lite 暂不追求 Kubernetes、高可用、多组织 SaaS、完整 CI/CD 和全量外部通知渠道。详细落地计划见：

- [V1.0 Lite 快速落地计划](docs/V1_LITE_LAUNCH_PLAN.md)
- [V1.0 Lite 验收清单](docs/ACCEPTANCE_V1_LITE.md)
- [V1.0 Lite 默认试点流程](docs/V1_LITE_PILOT_PROCESS.md)

## 项目文档

开始任何新需求前，先阅读：

- [领域上下文](CONTEXT.md)
- [项目开发与管理流程](docs/PROJECT_WORKFLOW.md)

想了解当前页面底层具体做了什么：

[阅读当前版本实现说明](docs/CURRENT_IMPLEMENTATION.md)

想了解从当前原型到企业生产平台的技术架构、开源工具和 V0-V2 版本路线：

[阅读完整项目建设蓝图](docs/PROJECT_MASTER_PLAN.md)

当前阶段的本地 PRD、Issue 和状态放在 `.scratch/`，该目录不提交 Git。

项目采用：

```text
Matt Pocock Skills：上下文、PRD、Issue、Triage、Handoff
Superpowers：Brainstorming、Plan、TDD、Debug、Verification
```

## 当前技术栈

- React 19
- TypeScript 6
- Vite 8
- React Router 7
- React Flow 12
- Lucide React
- Oxlint
- 原生 CSS
- FastAPI
- Pydantic
- SQLAlchemy
- SQLite / PostgreSQL
- Vitest / Testing Library / Pytest / Playwright

## 本地运行

首次安装：

```powershell
npm install
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e ".\apps\api[test]"
```

终端 1，启动 API：

```powershell
cd apps\api
..\..\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```

终端 2，启动前端：

```powershell
npm run dev -- --host 127.0.0.1 --port 4173
```

终端 3，启动异步执行 Worker：

```powershell
cd apps\api
..\..\.venv\Scripts\python.exe -m app.worker --worker-id local-worker
```

只处理一次队列任务用于本地验收：

```powershell
cd apps\api
..\..\.venv\Scripts\python.exe -m app.worker --worker-id local-worker --once
```

当前开发服务：

```text
http://127.0.0.1:4173
```

API 文档：

```text
http://127.0.0.1:8000/docs
```

默认数据库文件是 `apps/api/data/arc_one.db`。

使用 PostgreSQL 时，先在 PowerShell 中设置 `POSTGRES_PASSWORD`。只启动数据库：

```powershell
$env:POSTGRES_PASSWORD="<通过安全渠道提供的密码>"
docker compose up -d postgres
```

随后通过环境变量设置 `DATABASE_URL`。

如果要用 Compose 同时启动 API 和异步执行 Worker：

```powershell
$env:POSTGRES_PASSWORD="<通过安全渠道提供的密码>"
docker compose up --build api execution-worker
```

`api` 与 `execution-worker` 共用 `apps/api/Dockerfile`，并通过同一条
`DATABASE_URL` 连接 Compose 内的 `postgres`。当前机器 Docker CLI 可用但
Docker Desktop daemon 未运行，因此 Compose 配置解析已验证，容器构建和运行
尚未在本机完成验证。

## 检查

```powershell
npm test -- --run
.\.venv\Scripts\python.exe -m pytest .\apps\api\tests -q
npm run lint
npm run build
```
