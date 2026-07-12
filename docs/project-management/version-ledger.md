# ARC.ONE 版本台账

> 更新时间：2026-07-11

## 当前版本

- 当前产品迭代：V1.0 Lite，状态 `in-progress`。
- 当前安全切片：P0 运行时安全收口，状态 `ready-for-human`。
- 当前 `master`：`5a23d6cfbb0b30c1a4cd32fa6f966cbf2975ec6e`。
- 当前部署：GitHub `master` 与 Zeabur 公网 `deployment.json` SHA 一致。
- 当前工程验证：Python 3.12 后端 306 项、默认前端 242 项、lint、标准 build、部署检查和登录后 E2E 同轮通过。
- 当前事实入口：`docs/project-management/project-overview.md`。

版本状态只表示对应切片的证据，不代表整个企业生产平台已经完成。

## 版本记录

| 版本段 | 主题 | 当前状态 | 已交付边界 | 主要证据 |
|---|---|---|---|---|
| V0.1 | 高保真前端原型 | 历史完成 | 信息架构、核心页面和 DAG 交互原型 | 历史实现记录 |
| V0.2-V0.6 | 持久化、生命周期、执行与人工闭环 | absorbed / done | Agent/Workflow 版本、真实模型端口、Run、Artifact、Human Task、Feedback、Golden Sample | 旧 `.scratch` Issue 与实现测试 |
| V0.7A-V0.7B | 身份、Workspace 与安全治理 | 已进入当前基线 | 登录、Session、邀请、固定 RBAC、Reviewer 用户绑定、审计、Workspace 隔离 | `docs/ACCEPTANCE_V0.7B.md` 及相关测试 |
| V0.8-V0.9 | 观测、评估与回归 | 已进入当前基线 | Observability、Human SLA、Rubric、Evaluation、Golden Set、Regression | `docs/ACCEPTANCE_V0.8*.md`、`ACCEPTANCE_V0.9*.md` |
| V0.10-V0.15 | Remediation、Runtime、队列与 Provider | 已进入当前基线 | 评估问题闭环、Agent Runtime、异步队列、Worker、Model Provider | `docs/ACCEPTANCE_V0.10*.md` 至 `ACCEPTANCE_V0.15*.md` |
| V0.16-V0.24 | Tool/Skill、权限、Trace、Run 与 Workflow Schema | 已进入当前基线 | 稳定资产引用、审计、运行操作、Workflow 编辑、IO Schema 和字段映射 | `docs/ACCEPTANCE_V0.16*.md` 至 `ACCEPTANCE_V0.24*.md` |
| V0.25-V0.31F | Data Object、Artifact、Remediation 与 Notification | 已进入当前基线 | 数据对象、产出物追溯、修复任务、Outbox、渠道资产与启停治理 | `docs/ACCEPTANCE_V0.25*.md` 至 `ACCEPTANCE_V0.31F.md` |
| P0 Runtime Security | 凭证、代码执行与 Workspace 边界 | ready-for-human | Secret Ref/出口守卫、Package 禁止进程内执行、跨 Workspace 版本守卫 | `docs/ACCEPTANCE_P0_RUNTIME_SECURITY.md` |
| V1.0 Lite | 轻量可运行版与试点交付 | in-progress | 单服务核心闭环、种子资产、验收脚本、手册、GitHub/Zeabur 部署 | `docs/ACCEPTANCE_V1_LITE.md`、部署文档 |
| V1.0 | 企业生产版 | 未开始正式签收 | 高可用、迁移、备份恢复、SLO、性能与正式业务运营 | `docs/PROJECT_MASTER_PLAN.md` |

## 版本编号口径

- V0.x 细版本记录已经交付过的能力切片和验收证据。
- V1.0 Lite 是当前产品迭代口径，用于真实业务试点。
- V1.0 是企业生产版目标，不得与 V1.0 Lite 混用。
- 已进入 `master` 的细版本不再因为旧 `.scratch` 缺失而降级为 `placeholder`；但具体能力
  仍必须按 Acceptance 和源码边界描述，不能把第一切片扩写成完整生产能力。

## 当前完成条件

V1.0 Lite 只有同时满足以下条件才可从 `in-progress` 进入签收完成：

1. 默认前后端测试、lint、标准 build 和登录后 E2E 具有同一轮新证据。
2. P0 运行时安全完成人工审阅，曾暴露的真实模型 Key 已轮换。
3. 真实业务方按用户手册独立完成一次端到端闭环。
4. `docs/ACCEPTANCE_V1_LITE.md` 必过项逐项勾选并记录验收人、时间和运行证据。
5. 所有 P0/P1 试点问题关闭，P2/P3 有负责人和后续版本。

## 当前已知风险

- 主前端 JS 约 716.97 KB，仍有 Vite chunk-size warning。
- FastAPI TestClient 依赖层仍有 Starlette/httpx 弃用警告，后续升级依赖时需复核。
- 自动 E2E 使用隔离数据库和固定非生产测试管理员，只能作为工程证据，不能代替业务签收。
- Dashboard 仍为演示数据；MCP、Python Package Runtime 和外部通知均有明确能力边界。
- PostgreSQL 正式迁移、备份恢复、自动回滚、高可用和正式 SLO 尚未完成。
- `.scratch/` 默认不受 Git 跟踪，长期结论若未沉淀到 `docs/` 仍可能随机器或会话丢失。
