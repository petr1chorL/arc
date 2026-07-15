# ARC.ONE 当前项目状态

> 事实快照：2026-07-15
> 当前产品迭代：V1.0 Lite（`in-progress`）
> 当前安全切片：P0 运行时安全收口（`ready-for-human`）
> 当前可靠性切片：Agent 空输出执行契约（`ready-for-human`）
> 当前集成切片：远程 Agent API（`ready-for-human`）
> 当前部署基线：GitHub `master` / Zeabur commit `6683de19821b0108580bf8c7720f8f3a74d0b618`

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

2026-07-11 已确认公网首页和 `/api/health` 返回 200，`deployment.json` 的 commit 与
GitHub `master` 完整 SHA 一致。这证明当前提交已上线，不代表高可用、备份恢复、自动
回滚或正式 SLO 已完成。

## 能力地图

| 能力域 | 当前判断 | 已实现边界 |
|---|---|---|
| 身份与 Workspace | 已实现第一版 | 登录、Session、邀请、成员、固定 RBAC、Reviewer 绑定、Workspace 隔离与审计 |
| Agent 生命周期 | 已实现 | 草稿、编辑、发布不可变版本、停用、测试运行、Provider 与 Tool/Skill 绑定 |
| Workflow 生命周期 | 已实现 | DAG 编辑与校验、输入输出 Schema、字段映射、发布快照、运行与历史记录 |
| Agent Runtime | 已实现基础闭环 | 平台内置模型调用与同步远程 Agent API、有限重试、Token/成本字段、脱敏错误、HTTP Tool 调用；历史 Python Package 只读且失败关闭 |
| 执行与队列 | 已实现第一版 | 同步/异步运行、Worker、租约/心跳、重试、死信、取消、重投和操作审计 |
| Human Review | 已实现 | 暂停、审核资格、认领/会签、通过/驳回、恢复、反馈候选与 Golden Sample |
| Evaluation | 已实现第一版运行闭环 | Rubric 不可变版本、Provider/模型绑定、工作流 Evaluation 节点、系统加权总分、逐维度理由、Evaluation Record；Golden Set、Regression 与 Remediation 继续兼容 |
| Data Object / Artifact | 已实现第一版 | Data Object 版本、Artifact 契约、Schema 状态、目录、详情和运行追溯 |
| Observability | 已实现查询与追溯 | Run/NodeRun、Trace/Span、执行事件、成本摘要、队列和审计联动；无实时推送 |
| Tool / Skill | 已实现治理骨架 | Workspace 资产、稳定引用、HTTP allowlist、调用日志；真实 MCP Client 未接入 |
| Model Provider | 已实现治理骨架 | Provider 资产、环境变量 Secret Ref、HTTPS/Host 白名单、影响面与审计 |
| Notification | 已实现治理与 Outbox | Outbox、Worker、失败重投、渠道资产和状态治理；外部渠道适配不完整 |
| 运营总览 | 演示数据 | `src/pages/Dashboard.tsx` 仍读取 `src/data/mock.ts` |

## P0 运行时安全边界

2026-07-10 完成的 P0 安全切片已经：

- 禁止模型 Provider 保存内联 Key，只允许后端环境变量名形式的 Secret Ref。
- 在最终模型出口执行 HTTPS 与精确 Host 白名单校验。
- 已移除新的 Python Package 配置与发布入口；历史快照保持只读，在 API 进程内不会导入或执行。
- 远程 Agent API 强制 HTTPS，并按 `Workspace + 精确 Host + Secret Ref` 三元绑定外呼；
  同时限制响应大小与总时限，且不跟随重定向。
- 在 Workflow 校验和 Runtime 两层阻断跨 Workspace AgentVersion 引用。
- 清理历史非法 Secret Ref，且不在响应、日志或审计中回显原值。

安全与远程接入的工程证据分别位于 `docs/ACCEPTANCE_P0_RUNTIME_SECURITY.md` 和
`docs/ACCEPTANCE_REMOTE_AGENT_API.md`，当前仍等待人工审阅，并要求轮换任何曾在界面
或对话中暴露过的真实模型 Key。

## 明确未完成

- 真实业务方尚未按手册独立完成 V1.0 Lite 签收；现有记录是自动技术验收。
- Dashboard 仍是演示指标，不应作为真实经营数据引用。
- 不再提供 Python Package 新接入；历史 Package 快照没有执行器。远程 Agent API 首版仍缺少独立 Endpoint 资产、私网 DNS 出口代理、异步协议、远端协作式取消和真实业务验收。
- MCP 只有可注入测试骨架，未连接确定的真实 MCP Server。
- 外部通知渠道尚未形成全面、经过业务验收的真实投递能力。
- 没有正式 Secret Manager/Vault、密钥轮换 API 或通用网络出口代理。
- PostgreSQL 正式迁移体系、备份恢复演练、自动回滚和灾难恢复未完成。
- 没有生产级高可用、正式 SLO、完整实时日志/Trace 基础设施和性能压测结论。
- 当前仍是单体 API 与单页应用；`main.py`、Evaluations 和 Workflows 页面已形成大型热点。

## 2026-07-15 验证状态

| 检查 | 本轮结果 | 解释 |
|---|---|---|
| GitHub / Zeabur commit 对齐 | 通过 | 公网 `deployment.json` 与 `master` SHA 一致 |
| Zeabur 首页和健康接口 | 通过 | 首页与 `/api/health` 返回 200 |
| `npm run lint` | 通过 | 本轮新证据 |
| `npm run deploy:check` | 通过 | 部署契约检查通过 |
| 默认前端全量测试 | 43 文件 / 261 项通过 | `npm test -- --run`，17.17 秒 |
| 标准 `npm run build` | 通过 | TypeScript + Vite 正常生成 `dist`；主 JS 729.16 KB，保留大包警告 |
| 后端验证 | 386 项全量基线 + 87 项最终变更路径回归 | 全量 303.4 秒；最终 Gateway 23、Runtime 13、Execution 51；仅保留依赖弃用警告 |
| Playwright E2E | 2 项通过 | 隔离 SQLite、非生产测试管理员、真实登录；16.2 秒 |
| 远程 Agent 浏览器验收 | 通过 | 创建、配置、保存并发布远程 Agent；页面无 Package 入口，console 无错误或警告 |

本轮工程验证已经恢复并同轮通过，但这只清除了“无法重复验证”的工程阻断，不等于
P0 安全人工签收或 V1.0 Lite 业务签收已经完成。

## 当前优先级

1. **P0：完成人工安全签收。** 轮换可能暴露的模型 Key，人工确认 Secret Ref、出口、
   Package 禁用和 Workspace 隔离边界。
2. **P0：完成真实业务试点。** 由业务方独立完成运行、审核、评分、回归和 Trace 查看，
   逐项勾选 `docs/ACCEPTANCE_V1_LITE.md`。
3. **P1：处理试点问题。** 关闭 P0/P1 问题，为 P2/P3 指定负责人和后续版本。
4. **P1：根据试点决定下一主线。** 稳定性不足则优先迁移、备份、队列可靠性和观测；
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
