# ARC.ONE 源码盘点

> 盘点日期：2026-07-11
> 基线：`master` / `5a23d6cfbb0b30c1a4cd32fa6f966cbf2975ec6e`
> 范围：前端 `src/`、后端 `apps/api/`、测试、部署、`.scratch/` 和项目文档。
> 排除：`.env`、数据库文件、依赖目录、虚拟环境内容和构建产物。

## 结论

当前源码已明显超过早期 V0.1/V0.6 文档描述：它是 React + FastAPI + SQLAlchemy
组成的 V1.0 Lite 可运行原型，包含约 4.6 万行 TypeScript/Python、123 个 FastAPI 路由、
34 个核心数据库记录类型、43 个前端测试文件和 34 个后端测试文件。

当前 `master` 已进入 GitHub，并以同一完整 SHA 部署到 Zeabur。V1.0 Lite 仍为
`in-progress`，因为业务方独立签收和企业生产边界尚未闭合。

## 当前源码能力

| 能力 | 主要源码证据 | 判断 |
|---|---|---|
| 登录、Session、邀请、成员与 RBAC | `app/auth.py`、`routers/auth.py`、`routers/workspaces.py`、前端 `auth/` | 已实现第一版 |
| Workspace 数据隔离与审计 | `app/access.py`、`app/audit.py`、Workspace 路由与测试 | 已实现第一版 |
| Agent / AgentVersion 生命周期 | `app/main.py`、`models.py`、`AgentDetail.tsx` | 已实现 |
| Workflow / WorkflowVersion 生命周期 | `domain.py`、`execution.py`、`Workflows.tsx` | 已实现 |
| Run / NodeRun / Artifact | `execution.py`、`models.py`、Runs/Artifacts 页面 | 已实现 |
| Human Task 与反馈闭环 | `human_tasks.py`、Reviews 页面 | 已实现 |
| Evaluation / Regression / Remediation | Evaluation 路由、模型与 `Evaluations.tsx` | 已实现第一版 |
| Agent Runtime / Model Provider | `agent_runtime.py`、`model_gateway.py`、Provider 页面 | 已实现受控基础路径 |
| Tool / Skill 与 HTTP Tool | `tool_runtime.py`、AssetLibrary 页面 | 已实现治理与 HTTP 调用；MCP 为骨架 |
| 异步队列和 Worker | `execution.py`、`worker.py`、ExecutionJob 模型 | 已实现第一版 |
| Observability / Trace / Audit 联动 | Observability API、`Observability.tsx` | 已实现查询与追溯 |
| Notification Outbox / Channel | `notification_dispatcher.py`、`notification_worker.py`、相关页面 | 已实现治理骨架 |
| V1 Lite 种子与验收 | `v1_lite_seed.py`、`scripts/*v1-lite*` | 自动技术链路存在 |
| GitHub -> Zeabur 部署 | `.github/workflows/ci.yml`、`deploy-zeabur.yml`、根 Dockerfile | 已实现并在线 |

## 原型或范围外能力

| 能力 | 当前事实 |
|---|---|
| Dashboard | 仍读取 `src/data/mock.ts`，属于演示指标 |
| Python Package Runtime | 只登记元数据；隔离执行器上线前禁止执行 |
| MCP | 仅有可注入 Gateway 测试骨架，没有确定的真实 Server Client |
| 模型密钥 | 只支持环境变量 Secret Ref；没有 Secret Manager/Vault 管理面 |
| 实时观测 | 没有 SSE/WebSocket；当前以持久化查询和统一事件派生为主 |
| PostgreSQL 生产治理 | 可连接和部署，但正式迁移、备份恢复、灾难演练未完成 |
| 外部通知 | Outbox、渠道资产和路由治理存在，真实渠道覆盖和业务验收不完整 |
| 企业生产能力 | 无高可用、正式 SLO、性能压测、自动回滚和完整安全评审 |

## 工程热点

| 文件 | 规模 | 风险 |
|---|---:|---|
| `apps/api/app/main.py` | 6415 行 | 大量领域 API 集中在单文件，修改影响面持续扩大 |
| `src/pages/Evaluations.tsx` | 3103 行 | 评估、回归和补救交互耦合 |
| `src/pages/Workflows.tsx` | 2179 行 | 编排、Schema、运行和编辑状态耦合 |
| `apps/api/app/schemas.py` | 1910 行 | 多领域请求响应模型集中 |
| 前端生产主包 | 约 717 KB | Vite 持续报告大包警告 |

不因本次盘点直接重构这些文件。后续只有在具体变更反复跨越同一边界时，才以行为测试
保护的方式拆分。

## 2026-07-11 新验证

| 检查 | 结果 |
|---|---|
| GitHub 仓库与 `master` commit | 已确认 `petr1chorL/arc` / `5a23d6c...` |
| Zeabur 首页 | HTTP 200 |
| Zeabur `/api/health` | HTTP 200，`{"status":"ok"}` |
| Zeabur `/deployment.json` | 与 GitHub `master` 完整 SHA 一致 |
| `npm run lint` | 通过 |
| `npm run deploy:check` | 通过 |
| 默认前端测试 | 43 文件、242 项通过；12.54 秒 |
| 前端测试（单 worker） | 43 文件、242 项通过；84.76 秒 |
| 标准 `npm run build` | 通过；主 JS 716.97 KB，保留大包警告 |
| 后端全量测试 | Python 3.12.13；306 项通过；257 秒 |
| Playwright E2E | 2 项通过；覆盖登录、Agent 持久化、AgentVersion/WorkflowVersion 引用 |

## 文档偏差处理

- `AGENTS.md` 已从 V0.1 定位更新为 V1.0 Lite，并指向唯一当前事实入口。
- `project-overview.md` 已重建为 2026-07-11 当前事实快照。
- `version-ledger.md` 不再把已归并实现标记为 placeholder。
- `PROJECT_ROADMAP_TO_V1.md` 不再把已经实现的 V0.13A 队列列为下一步。
- `ACCEPTANCE_V1_LITE.md` 明确自动技术验收不等于业务方签收。
- `CURRENT_IMPLEMENTATION.md` 保留详细历史，但不再承担唯一项目级状态职责。

## 下一步审计入口

1. 完成 P0 人工安全复核后，更新 `docs/ACCEPTANCE_P0_RUNTIME_SECURITY.md` 对应状态。
2. 业务方签收后，逐项勾选 `docs/ACCEPTANCE_V1_LITE.md`，不得只追加自动化运行记录。
3. 若试点暴露性能问题，优先处理约 717 KB 主包和大型热点文件，不在无证据时先行重构。
