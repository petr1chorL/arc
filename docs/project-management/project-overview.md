# ARC.ONE 当前项目状态

> 事实快照：2026-07-15
> 当前产品迭代：V1.0 Lite（`in-progress`）
> 当前安全切片：P0 运行时安全收口（`ready-for-human`）
> 当前可靠性切片：生产启动可用性恢复（`in-progress`）
> 当前部署基线：GitHub `master=3bd30c9`；Zeabur 已回滚至 `fc59082`

本文是项目级唯一当前事实入口，用于回答“项目是什么、已经做到哪、明确没做到什么、
现在应该做什么”。发生冲突时，按以下优先级判断：

```text
当前源码与本轮验证
> 本文
> 具体 Acceptance / PRD / Issue
> docs/CURRENT_IMPLEMENTATION.md 的历史实现记录
> 路线图与长期蓝图
```

## 项目定位

ARC.ONE 是面向企业的 Agentic Workflow 操作系统，用于管理 Agent 资产、工作流编排、
结构化产出物、质量评估、人工审核、运行观测与持续优化。

当前形态不是单纯的拖拽页面，也不是企业生产平台，而是已经具备真实 API、持久化和
模型调用边界的 V1.0 Lite 可运行原型。目标是先让一个真实业务团队独立跑通一条闭环，
再决定下一阶段生产化或外部集成方向。

## 当前可运行基线

- 前端：React 19、TypeScript、Vite、React Router、React Flow。
- 后端：FastAPI、Pydantic、SQLAlchemy。
- 数据：本地默认 SQLite，部署可使用 PostgreSQL。
- AI：OpenAI-compatible ModelGateway；自动化测试使用 FakeGateway。
- 部署：GitHub Pull Request / CI -> `master` -> Zeabur 同源容器 -> Zeabur PostgreSQL。
- 公网入口：`https://arc-v1-lite-lindabaoz.zeabur.app/`。

2026-07-15，`3bd30c9` 的静态页面与 `deployment.json` 已出现，但 `/api/health`
持续返回 502；生产随后通过受控 workflow 回滚到 `fc59082` 并恢复 API 200。因此当前
生产与 `master` 暂时不一致：回滚版本可用，`3bd30c9` 中的工作流评估节点尚未重新上线。
这次事故同时证明静态 SHA 只能标识页面版本，不能代替 API 健康、登录或 Seed 状态证据。

## 能力地图

| 能力域 | 当前判断 | 已实现边界 |
|---|---|---|
| 身份与 Workspace | 已实现第一版 | 登录、Session、邀请、成员、固定 RBAC、Reviewer 绑定、Workspace 隔离与审计 |
| Agent 生命周期 | 已实现 | 草稿、编辑、发布不可变版本、停用、测试运行、Provider 与 Tool/Skill 绑定 |
| Workflow 生命周期 | 已实现 | DAG 编辑与校验、输入输出 Schema、字段映射、发布快照、运行与历史记录 |
| Agent Runtime | 已实现基础闭环 | 模型调用、空输出有限重试与失败、Token/成本字段、脱敏错误、HTTP Tool 调用；Python Package 仅登记 |
| 执行与队列 | 已实现第一版 | 同步/异步运行、Worker、租约/心跳、重试、死信、取消、重投和操作审计 |
| Human Review | 已实现 | 暂停、审核资格、认领/会签、通过/驳回、恢复、反馈候选与 Golden Sample |
| Evaluation | `master` 已实现，生产待恢复 | Rubric 不可变版本、Provider/模型绑定、工作流 Evaluation 节点、系统加权总分、逐维度理由、Evaluation Record；当前生产回滚版尚未包含该节点 |
| Data Object / Artifact | 已实现第一版 | Data Object 版本、Artifact 契约、Schema 状态、目录、详情和运行追溯 |
| Observability | 已实现查询与追溯 | Run/NodeRun、Trace/Span、执行事件、成本摘要、队列和审计联动；无实时推送 |
| Tool / Skill | 已实现治理骨架 | Workspace 资产、稳定引用、HTTP allowlist、调用日志；真实 MCP Client 未接入 |
| Model Provider | 已实现治理骨架 | Provider 资产、环境变量 Secret Ref、HTTPS/Host 白名单、影响面与审计 |
| Notification | 已实现治理与 Outbox | Outbox、Worker、失败重投、渠道资产和状态治理；外部渠道适配不完整 |
| 运营总览 | 演示数据 | `src/pages/Dashboard.tsx` 仍读取 `src/data/mock.ts` |

## 2026-07-15 生产启动事故

已确认的失效链不是评估业务 API 本身，而是部署启动边界：

- 旧 PostgreSQL 不会被现有 SQLite 兼容逻辑补齐 `rubrics.model_provider_id`。
- V1 Lite Seed 新增可用 Provider 前置条件，显式 Seed 因缺失配置应继续失败关闭。
- 根 Dockerfile 的 `&` 会后台化整条 Bootstrap/Seed/Uvicorn 链；后端失败后 Nginx 仍提供
  静态页面和固定 200 的 `/healthz`，从而产生“页面在线、API 502”的假健康。

当前热修复采用定向 PostgreSQL 幂等补列、仅对 Provider 不可用进行结构化 Seed 跳过、
由 PID 1 入口先确认 FastAPI 健康再开放 Nginx、在 API 退出时结束容器，以及让 `/healthz`
代理 FastAPI。该修复仍在功能分支，
尚未合并或重新部署；一条定向补列不代表正式 PostgreSQL 迁移体系已经完成。



## P0 运行时安全边界

2026-07-10 完成的 P0 安全切片已经：

- 禁止模型 Provider 保存内联 Key，只允许后端环境变量名形式的 Secret Ref。
- 在最终模型出口执行 HTTPS 与精确 Host 白名单校验。
- 禁止 Python Package 在 API 进程内动态导入和执行，只保留元数据登记。
- 在 Workflow 校验和 Runtime 两层阻断跨 Workspace AgentVersion 引用。
- 清理历史非法 Secret Ref，且不在响应、日志或审计中回显原值。

该切片的工程证据位于 `docs/ACCEPTANCE_P0_RUNTIME_SECURITY.md`，当前仍等待人工审阅，
并要求轮换任何曾在界面或对话中暴露过的真实模型 Key。

## 明确未完成

- 真实业务方尚未按手册独立完成 V1.0 Lite 签收；现有记录是自动技术验收。
- Dashboard 仍是演示指标，不应作为真实经营数据引用。
- Python Package 没有隔离执行器、签名验证、资源配额和沙箱。
- MCP 只有可注入测试骨架，未连接确定的真实 MCP Server。
- 外部通知渠道尚未形成全面、经过业务验收的真实投递能力。
- 没有正式 Secret Manager/Vault、密钥轮换 API 或通用网络出口代理。
- PostgreSQL 正式迁移体系、备份恢复演练、自动回滚和灾难恢复未完成。
- 没有生产级高可用、正式 SLO、完整实时日志/Trace 基础设施和性能压测结论。
- 当前仍是单体 API 与单页应用；`main.py`、Evaluations 和 Workflows 页面已形成大型热点。

## 2026-07-13 验证状态

| 检查 | 本轮结果 | 解释 |
|---|---|---|
| GitHub / Zeabur commit 对齐 | 通过 | 公网 `deployment.json` 与 `master` SHA 一致 |
| Zeabur 首页和健康接口 | 通过 | 首页与 `/api/health` 返回 200 |
| `npm run lint` | 通过 | 本轮新证据 |
| `npm run deploy:check` | 通过 | 部署契约检查通过 |
| 默认前端全量测试 | 43 文件 / 243 项通过 | `npm test -- --run`，12.49 秒 |
| 标准 `npm run build` | 通过 | TypeScript + Vite 正常生成 `dist`；主 JS 716.98 KB，保留大包警告 |
| 后端全量测试 | 309 项通过 | Python 3.12.13，250.4 秒；保留依赖层 Starlette/httpx 弃用警告 |
| Playwright E2E | 2 项通过 | 隔离 SQLite、非生产测试管理员、真实登录；16.2 秒 |

本轮工程验证已经恢复并同轮通过，但这只清除了“无法重复验证”的工程阻断，不等于
P0 安全人工签收或 V1.0 Lite 业务签收已经完成。

## 当前优先级

1. **P0：恢复生产启动并重新上线 `master`。** 完成热修复全量验证、PR/CI、精确 SHA
   部署，并分别确认 `/api/health`、真实登录与 Seed completed/skipped 状态。
2. **P0：完成人工安全签收。** 轮换可能暴露的模型 Key，人工确认 Secret Ref、出口、
   Package 禁用和 Workspace 隔离边界。
3. **P0：完成真实业务试点。** 由业务方独立完成运行、审核、评分、回归和 Trace 查看，
   逐项勾选 `docs/ACCEPTANCE_V1_LITE.md`。
4. **P1：简化评估中心。** 仅在生产恢复并完成工作流评估节点线上验收后继续 Issue 02。
5. **P1：根据试点决定下一主线。** 稳定性不足则优先正式迁移、备份、队列可靠性和观测；
   价值不足则选择一个真实数据源或通知渠道，不再按细版本编号惯性扩功能。


## 2026-07-13 真实试点问题

审核上下文修复已合并并部署，线上默认 Workflow 为 `v1.3.0`；使用非空审核理由的真实模型复测
确认 `reviewedArtifact`、审核决定和审核理由已经进入“审核后修订”输入。

同一次复测暴露新的 P1 可靠性缺陷：模型空输出仍被 Agent Runtime 标记为成功，导致 NodeRun
显示通过、没有 Artifact，并由工作流原始输入驱动下游继续执行。当前工程修复已把空字符串和纯空白
响应纳入有限重试；耗尽后 NodeRun 与 Run 失败并停止 DAG，不创建空 Artifact 或 Human Review。
短但非空输出仍走现有低分复核路径。

该可靠性修复在合并、重新部署并完成线上真实模型复测前，仍不能视为线上问题关闭；即使复测通过，
也只证明最低非空输出契约，不代表结构化 Schema 或业务语义一定正确。此前在对话中暴露的模型 Key
轮换仍是独立的 P0 安全阻断。

## 文档职责

| 信息 | 入口 |
|---|---|
| 当前项目事实 | `docs/project-management/project-overview.md` |
| 领域语言 | `CONTEXT.md` |
| 详细实现与历史版本记录 | `docs/CURRENT_IMPLEMENTATION.md` |
| 当前源码盘点 | `docs/project-management/source-audit.md` |
| 版本台账 | `docs/project-management/version-ledger.md` |
| 当前路线 | `docs/PROJECT_ROADMAP_TO_V1.md` |
| 长期蓝图 | `docs/PROJECT_MASTER_PLAN.md` |
| V1 Lite 验收 | `docs/ACCEPTANCE_V1_LITE.md` |
| 当前功能 PRD / Issue | `.scratch/<feature>/` |

`.scratch/` 默认被 Git 忽略，只适合本地任务管理。任何会影响后续会话、部署、产品边界
或安全判断的长期结论，都必须同步到受 Git 跟踪的文档、源码或测试中。
