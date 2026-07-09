# ARC.ONE 版本台账

## 当前版本

- 当前产品迭代：V1.0 Lite。
- 当前 `master` 实现基线：已归并 `codex/v0.7a-identity-access`，包含 V0.7A-V0.31F 与 V1.0 Lite 交付包。
- 当前工程决策点：以合并后的 `master` 为新基线，继续收敛 V1.0 Lite 试点范围和验证证据。
- 事实来源：`docs/CURRENT_IMPLEMENTATION.md`。
- 源码盘点：`docs/project-management/source-audit.md`。
- 分支审计：`docs/project-management/branch-audit.md`。
- 本台账只记录已验证或已有明确文档证据的版本状态。

## 版本记录

| 版本 | 主题 | 状态 | 已交付内容 | 验证证据 | 遗留问题 |
|---|---|---|---|---|---|
| V0.1 | 高保真前端原型 | 历史完成 | 六个一级页面、DAG 画布、响应式外壳 | Lint、Build、浏览器验证记录见历史文档 | 无后端和真实执行 |
| V0.2 | 平台契约与持久化基础 | absorbed | Agent 创建、字段校验、SQLAlchemy 持久化、SQLite 默认存储 | `.scratch/platform-foundation/issues/01-create-and-reload-agent.md` | 本地 issue 02-04 未同步勾选，需以 V0.6 当前实现为准 |
| V0.3-V0.4 | Agent / Workflow 生命周期 | done | Agent 草稿、不可变 AgentVersion、Workflow 草稿、DAG 校验、不可变 WorkflowVersion | `.scratch/agent-workflow-lifecycle/issues/*.md` 验收均已勾选 | PRD 仍标 `ready-for-human`，可视为历史状态未收敛 |
| V0.5 | 真实 Agent 执行闭环 | 已完成历史阶段 | ModelGateway、Agent 测试运行、工作流顺序执行、Run/NodeRun/Artifact 持久化 | Pytest 12 项、Vitest 18 项、Lint、Build、浏览器验证、DeepSeek 联调 | 成本单价环境变量未配置，成本暂为 0 |
| V0.6 | 人工协作与反馈闭环 | 已完成 | Human Task、暂停恢复、分配会签、SLA、FeedbackCandidate、Golden Sample | 后端 34 项、前端 30 项、Lint、Build、桌面/移动浏览器验证 | 无登录、RBAC、外部通知和后台调度器 |
| V0.7A | 身份、Workspace 与访问控制 | 进行中 | 已有设计、计划和安全原语代码 | `test_security.py` 通过；全量后端 34 项通过 | 尚无认证路由、User/Workspace/Session 模型、RBAC 和 workspace 化 API；本地 PRD/status 和 02-07 issue 缺失 |
| V0.16D | Tool / Skill 稳定引用 | placeholder | 尚无可验证交付记录 | `.scratch/v0.16d-tool-skill-stable-references/` 目录 | 需要补 PRD/Issue 或并入治理主线 |
| V0.24D | Schema 运行表单 | placeholder | 尚无可验证交付记录 | `.scratch/v0.24d-schema-run-form/` 目录 | 需要补 PRD/Issue |
| V0.24E | Schema 字段选择器 | ready-for-agent | 已有 PRD、issue 和实施计划 | `.scratch/v0.24e-schema-field-picker/`；`docs/superpowers/plans/2026-06-28-v0.24e-schema-field-picker.md` | 尚无验收勾选记录 |
| V0.26E | Artifact Schema 状态 | placeholder | 尚无可验证交付记录 | `.scratch/v0.26e-artifact-schema-status/` 目录 | 建议并入 V0.8 Data Object 主线 |
| V0.28C | Remediation 来源链接 | placeholder | 尚无可验证交付记录 | `.scratch/v0.28c-remediation-source-links/` 目录 | 需要先确认 Remediation 领域模型 |
| V0.29B | Remediation 任务详情 API | placeholder | 尚无可验证交付记录 | `.scratch/v0.29b-remediation-task-detail-api/` 目录 | 建议与 V0.28C 合并规划 |
| V1.0 Lite | 轻量可运行版 | in-progress | 单机核心闭环、V0.6 已完成能力、V0.7A 安全原语 | `.scratch/v1.0-lite/status.md`；当前全量测试通过 | 需要补 PRD 和验收边界；不能等同企业生产版 V1.0 |

## 已归并分支版本补记

以下版本来自已归并的 `codex/v0.7a-identity-access` 分支，当前已进入 `master` 基线；后续仍需按功能重新补齐验收证据。

| 版本段 | 状态 | 证据入口 | 备注 |
|---|---|---|---|
| V0.7A-V0.7B | 分支已实现/验收材料存在 | `docs/ACCEPTANCE_V0.7B.md`、相关提交 | 身份、Workspace、RBAC、成员管理、审计与 Review Workbench |
| V0.8-V0.9 | 分支已实现/验收材料存在 | `docs/ACCEPTANCE_V0.8*`、`docs/ACCEPTANCE_V0.9*` | 观测、成本、Human SLA、Evaluation、Rubric、Golden Set、Regression |
| V0.10-V0.15 | 分支已实现/验收材料存在 | `docs/ACCEPTANCE_V0.10*` 至 `docs/ACCEPTANCE_V0.15*` | Regression 趋势、Remediation、Runtime、队列、Model Provider |
| V0.16-V0.24 | 分支已实现/验收材料存在 | `docs/ACCEPTANCE_V0.16*` 至 `docs/ACCEPTANCE_V0.24*` | Tool/Skill、资产审计、权限矩阵、Trace、Run 操作、Workflow 编辑、Schema |
| V0.25-V0.31F | 分支已实现/验收材料存在 | `docs/ACCEPTANCE_V0.25*` 至 `docs/ACCEPTANCE_V0.31F.md` | Data Object、Artifact、Remediation、Notification Outbox、Channel Assets |
| V1.0 Lite | 分支交付包存在 | `docs/V1_LITE_LAUNCH_PLAN.md`、`docs/ACCEPTANCE_V1_LITE.md`、`scripts/check-v1-lite.ps1` | 已归并，仍需持续验证试点路径 |

## 版本编号口径

本台账分两种粒度：

- 主线版本：V0.1、V0.2、V0.5、V0.6、V0.7A、V1.0 Lite、V0.8、V0.9、V1.0，用于路线图沟通。
- 细版本：V0.16D、V0.24D、V0.24E、V0.26E、V0.28C、V0.29B，用于记录已经出现的局部功能包。

细版本即使只有空目录，也要在台账中保留。状态用 `placeholder` 标明，避免误以为已经完成或被删除。

V1.0 Lite 是当前产品迭代口径，表示轻量可运行版；V1.0 是企业生产版规划口径，二者不能混用。

## 已完成能力索引

| 能力 | 入口 |
|---|---|
| Agent 创建与持久化 | `.scratch/platform-foundation/issues/01-create-and-reload-agent.md` |
| Agent 编辑、发布和停用 | `.scratch/agent-workflow-lifecycle/issues/01-agent-lifecycle.md` |
| Workflow 草稿、校验和发布 | `.scratch/agent-workflow-lifecycle/issues/02-workflow-lifecycle.md` |
| 真实 Agent / Workflow 执行 | `.scratch/real-agent-execution/` |
| Human Task 与反馈闭环 | `.scratch/human-collaboration-feedback/` |

## 当前已知风险

- `docs/PROJECT_MASTER_PLAN.md` 的“当前真实状态”部分早于 V0.6，不能直接作为当前实现事实。
- 当前 `master` 已合并 `codex/v0.7a-identity-access`；后续文档应以合并后的 master 为事实源。
- `.scratch/platform-foundation/status.md` 原内容明显过期，本轮已改为“被后续版本吸收”。
- V0.7A 本地 tracker 不完整，计划中要求 7 个 issue，但当前只有 1 个 issue 文件；源码只完成安全原语。
- V1.0 Lite 只有 status 入口，尚缺 PRD 和逐项验收标准。
- 若要进入生产级验证，仍需补 PostgreSQL/Alembic、Docker 环境、部署和安全验证。
