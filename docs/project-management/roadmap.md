# ARC.ONE 版本规划

> 文档状态：历史版本分解参考，不作为当前 Backlog。
> 状态校正日期：2026-07-11。
> 当前项目事实见 `docs/project-management/project-overview.md`；当前执行路线见
> `docs/PROJECT_ROADMAP_TO_V1.md`。下文保留归并前后出现过的版本结构和长期方向，表中
> `进行中`、`占位`、`ready-for-agent` 等旧状态不得覆盖当前源码、Acceptance 和版本台账。

## 规划原则

1. 先保证单条真实业务闭环可靠，再扩展更多页面和能力。
2. 先做版本化、权限、审计和测试证据，再做高风险自动化。
3. 结构化数据对象、质量评估、人工反馈和运行观测要共同演进。
4. 每个版本必须有可观察验收信号，不能只交付静态页面。

## 版本总览

> 分支校正：`codex/v0.7a-identity-access` 已归并到 `master`。路线图后续以合并后的 V1.0 Lite 基线为准，重点转向试点范围收敛、验证证据和生产化缺口治理。详见 `docs/project-management/branch-audit.md`。

| 版本 | 主题 | 状态 | 核心价值 |
|---|---|---|---|
| V0.1 | 高保真前端原型 | 已完成历史阶段 | 验证信息架构和核心交互 |
| V0.2 | 平台契约与持久化基础 | 已被后续版本吸收 | Agent 创建、保存和重载 |
| V0.3-V0.4 | Agent / Workflow 生命周期 | 已完成历史阶段 | AgentVersion / WorkflowVersion 稳定引用 |
| V0.5 | 真实 Agent 执行闭环 | 已完成历史阶段 | 已发布 Agent / Workflow 可运行并持久化证据 |
| V0.6 | 人工协作与反馈闭环 | 已完成 | Human 节点暂停、审核、恢复、反馈和 Golden Sample |
| V0.7A | 身份、Workspace 与访问控制 | 已进入当前基线 | 登录、Session、Workspace、RBAC、Reviewer 绑定、审计 |
| V0.7B | 安全治理扩展 | 已实现部分边界 | 模型/工具白名单、Secret Ref 与 P0 出口治理；预算和完整密钥托管未完成 |
| V0.16D | Tool / Skill 稳定引用 | 已进入当前基线 | Agent 发布快照冻结 Tool / Skill 稳定引用 |
| V0.24D | Schema 运行表单 | 已进入当前基线 | 用工作流输入 Schema 生成运行表单 |
| V0.24E | Schema 字段选择器 | 已进入当前基线 | 降低连线字段映射手写错误 |
| V0.26E | Artifact Schema 状态 | 已进入当前基线 | 产出物显式声明 Schema 校验状态 |
| V0.28C | Remediation 来源链接 | 已进入当前基线 | 补救任务可追溯到来源问题 |
| V0.29B | Remediation 任务详情 API | 已进入当前基线 | 补救任务详情 API 与深链直读 |
| V1.0 Lite | 轻量可运行版 | 当前迭代 | 单机可运行、核心闭环可演示、企业生产能力收敛中 |
| V0.8 | Data Object 与 Schema 化工作流 | 建议下一主线 | 节点输入输出、字段映射、产出物契约和血缘 |
| V0.9 | 实时运行与可观测性 | 待规划 | 实时状态、Trace、日志、运行回放和告警 |
| V1.0 | 企业可用闭环 | 待规划 | 生产部署、安全评审、备份恢复、操作手册 |

## 已归并分支路线补记

`codex/v0.7a-identity-access` 已经把原先规划中的大量阶段拆成细版本推进，并已归并为当前基线。路线图应从“继续 V0.7A/V0.8”改为“验证并收敛 V1.0 Lite”。

| 路线 | 分支覆盖版本 | 后续管理重点 |
|---|---|---|
| 身份与治理 | V0.7A-V0.7B、V0.18 | 归并后重新验权、审计和成员管理验收 |
| 评估与回归 | V0.9-V0.11 | 校验 Rubric、Golden Set、Regression、Remediation 是否形成真实闭环 |
| Runtime 与资产 | V0.12-V0.17 | 校验 Agent Runtime、Tool/Skill、Model Provider 与稳定引用 |
| 观测与操作 | V0.8、V0.19-V0.22 | 校验 Trace、Run 操作、Review URL、过滤分享链接 |
| Schema 与数据对象 | V0.23-V0.27 | 校验 Workflow 编辑体验、IO Schema、Data Object、Artifact Contract |
| 通知与试点交付 | V0.28-V0.31F、V1.0 Lite | 校验 Remediation、Notification Outbox、Channel Assets、Lite Runbook 和用户手册 |

## 细版本流水

本节保留仓库中已经出现过的细版本编号，避免项目管理时只看到合并后的大版本。
状态以当前 `.scratch/` 和 `docs/superpowers/` 证据为准。

| 版本 | 当前证据 | 状态 | 处理建议 |
|---|---|---|---|
| V0.2 | `.scratch/platform-foundation/` | absorbed | 不再按旧 issue 推进，作为历史基础能力归档 |
| V0.3-V0.4 | `.scratch/agent-workflow-lifecycle/` | done | 可补 `status.md` 收敛归档 |
| V0.5 | `.scratch/real-agent-execution/` | done | 作为执行闭环历史阶段保留 |
| V0.6 | `.scratch/human-collaboration-feedback/` | done | 作为当前已完成版本基线 |
| V0.7A | Acceptance、认证/Workspace 源码与测试 | merged-baseline | 保持当前实现，后续只按新缺陷补 Issue |
| V0.16D | `docs/ACCEPTANCE_V0.16D.md` | implemented | 已由后续 Runtime 稳定引用继续扩展 |
| V0.24D | `docs/ACCEPTANCE_V0.24D.md` | implemented | 已进入 Workflow 运行表单 |
| V0.24E | `docs/ACCEPTANCE_V0.24E.md` | implemented | 已进入连线字段映射交互 |
| V0.26E | `docs/ACCEPTANCE_V0.26E.md` | implemented | 已进入 Artifact Schema 状态链路 |
| V0.28C | `docs/ACCEPTANCE_V0.28C.md` | implemented | 已进入 Remediation 来源追溯 |
| V0.29B | `docs/ACCEPTANCE_V0.29B.md` | implemented | 已进入 Remediation 详情 API |
| V1.0 Lite | `.scratch/v1.0-lite/status.md` | in-progress | 工程验证已恢复；完成 P0 人工签收和真实业务验收 |

## 主线归并关系

| 主线 | 包含细版本 | 说明 |
|---|---|---|
| 平台基础 | V0.2、V0.3、V0.4 | 契约、持久化、Agent/Workflow 生命周期 |
| 执行与人工闭环 | V0.5、V0.6 | 真实运行、Human Task、反馈与 Golden Sample |
| 身份与治理 | V0.7A、V0.7B、V0.16D | 登录、权限、审计、Tool/Skill 引用和安全治理 |
| Schema 与产出物 | V0.24D、V0.24E、V0.26E、V0.8 | 运行表单、字段映射、Data Object、Artifact Schema |
| 补救与可观测 | V0.28C、V0.29B、V0.9 | Remediation、任务详情、Trace、日志和运行回放 |
| 轻量交付版 | V1.0 Lite | 将现有单机闭环收敛成可演示、可继续迭代的轻量版本 |

## V1.0 Lite：轻量可运行版

### 背景

V1.0 Lite 是当前项目的实际迭代口径，用于承接已经完成的 V0.6 单机闭环和正在推进的 V0.7A 身份治理基础。它强调“轻量可运行、核心闭环可演示”，不承诺企业生产版所需的高可用、正式迁移、CI/CD、备份恢复和完整安全评审。

### 建议范围

- 保留当前 Agent、工作流、运行、Human Task、反馈候选和 Golden Sample 闭环。
- 完成 V0.7A 中最小登录、Session、Workspace 路径和 Reviewer 用户绑定。
- 修正 Dashboard / Evaluations 中仍依赖 mock 的部分，至少明确展示“演示数据”标识或切换到真实摘要 API。
- 提供一条可重复的浏览器演示路径。
- 梳理 README、当前实现说明、版本台账和本地 status。

### 验收信号

- 新用户能按文档启动 API 和前端，完成核心演示路径。
- 匿名访问和审核操作者伪造问题得到最小治理。
- 当前版本文档不再混用 V0.6、V0.7A 和 V1.0 企业版口径。
- 所有未完成企业能力均被明确列为 Lite 版范围外。

### 不做

- 不等同于企业生产版 V1.0。
- 不承诺多组织 SaaS、SSO、生产高可用、Alembic 正式迁移、Kubernetes、完整 Trace 和告警。

## V0.7A：身份、Workspace 与访问控制

### 背景

V0.6 已经有运行和人工审核闭环，但 API 默认匿名可访问，Workspace 只是展示文本，Reviewer 也不是可信用户身份。这会阻塞多人协作、审计可信度和企业试点。

### 范围

- 本地邮箱密码登录、Argon2id 密码哈希、可撤销 Session。
- 单组织、多 Workspace、多成员。
- 固定角色层级：viewer、operator、builder、workspace_admin。
- 后端 capability 校验和 Workspace 级数据隔离。
- Reviewer 绑定真实 User，审核动作不能由前端伪造操作者。
- 成员邀请、激活、启停、角色调整。
- 平台审计查询和 CSV 导出。

### 验收信号

- 匿名用户无法访问业务 API。
- 跨 Workspace 访问返回安全失败。
- 权限矩阵有后端测试覆盖。
- 审核动作来自当前登录用户。
- 成功、失败和 denied 事件进入不可修改审计。
- 登录、邀请、激活、授权、审核、退出完成浏览器路径验证。

### 不做

- 企业 SSO、Keycloak、飞书登录。
- 多组织 SaaS、计费、组织自助开通。
- API Key / 模型密钥托管。
- 生产高可用 Session 存储。

## V0.7B：安全治理扩展

### 背景

V0.7A 解决“谁能操作”。V0.7B 解决“Agent 能调用什么、花多少钱、密钥怎么保管、不同环境怎么隔离”。

### 建议范围

- 模型和工具白名单。
- 密钥托管端口，避免业务代码直接处理明文凭证。
- 开发、测试、生产环境隔离。
- Workspace 预算、模型成本和运行配额。
- 高风险工具审批策略。
- 敏感字段和 Prompt 泄露检查。

### 验收信号

- Agent 只能使用授权模型和工具。
- 明文密钥不进入数据库、日志、前端和审计 metadata。
- 超预算或未授权调用被拒绝并记录审计。
- 不同环境的 Agent / Workflow 版本边界清楚。

## V0.8：Data Object 与 Schema 化工作流

### 背景

当前工作流已经能保存和运行，但节点之间的数据契约还不够强。V0.24E 字段选择器说明建设者已经开始感受到手写路径和隐式结构的成本。

### 建议范围

- 工作流级 input/output Schema。
- 节点输入输出 Schema。
- 可复用 Data Object 资产。
- 连线字段映射、类型校验和错误提示。
- 产出物 Schema 状态和字段级可读 Diff。
- Schema 版本与 Workflow Version 的引用关系。

### 验收信号

- 工作流发布前能校验节点契约和连线映射。
- 建设者不用手写常见字段路径即可完成映射。
- 运行时产出物能声明 Data Object 类型和版本。
- 下游节点输入缺失或类型不匹配时有明确错误。

## V0.9：实时运行与可观测性

### 背景

当前运行中心能查询持久化运行记录，但缺少实时进度、日志、Trace、故障聚类和回放。进入试点前，需要让平台能解释“为什么慢、为什么错、为什么贵”。

### 建议范围

- SSE 或 WebSocket 实时运行状态。
- 节点日志查询。
- Trace ID 串联 API、节点运行、模型调用和工具调用。
- Token、成本、耗时、重试和错误聚合。
- 运行终止、重跑和失败点恢复。
- 浏览器端运行回放。

### 验收信号

- 用户能实时看到工作流运行推进。
- 任意运行可追溯到节点输入、输出、模型、工具和错误。
- 失败后能定位节点，并按规则重试或恢复。
- 成本和 Token 统计不再依赖手工推断。

## V1.0：企业可用闭环

### 建议范围

- PostgreSQL 正式迁移体系。
- Docker Compose 与生产部署文档。
- 备份恢复和演练记录。
- 生产安全检查和权限验收。
- 关键路径 E2E 和视觉回归。
- 管理员手册和用户操作手册。

### 验收信号

- 具备明确 SLO、告警和恢复流程。
- 关键数据可备份、恢复和审计。
- 生产部署不是本地 SQLite 原型的直接外推。

## 暂缓事项

| 事项 | 暂缓原因 | 重新评估条件 |
|---|---|---|
| Temporal / LangGraph 全量引入 | 当前单体原型仍在验证领域闭环 | 长流程恢复、并行、人工等待和生产调度需求稳定 |
| 多组织 SaaS | V0.7A 只需单组织多 Workspace | 明确外部客户租户和计费模型 |
| 自定义权限编辑器 | 固定角色足够支撑早期协作 | 多团队出现角色组合冲突 |
| 大规模资产市场 | 复用机制尚未稳定 | 至少 3 条真实业务链路沉淀可复用资产 |
