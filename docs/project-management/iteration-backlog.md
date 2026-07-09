# ARC.ONE 迭代 Backlog

## 状态说明

| 状态 | 含义 |
|---|---|
| done | 验收标准已勾选，且有测试或浏览器证据 |
| absorbed | 已被后续版本实现覆盖，但本地旧 issue/status 未完全同步 |
| in-progress | 已进入开发或已有 RED/GREEN 记录，但未完成整版验收 |
| ready-for-agent | 范围和验收标准足够清楚，可交给 agent |
| merged-baseline | 高级分支已归并，需按新基线刷新验收证据和排期 |
| needs-triage | 需要重新确认范围、依赖或是否仍有价值 |
| placeholder | 只有目录或命名，没有 PRD/Issue 内容 |

## Backlog 总览

| 功能包 | 当前状态 | 价值 | 依赖 | 建议动作 |
|---|---|---|---|---|
| `human-collaboration-feedback` | done | 人工协作、恢复执行、反馈和 Golden Sample | V0.5 执行闭环 | 保持归档，只在发现实现变化时更新 |
| `real-agent-execution` | done | 真实模型调用和运行证据持久化 | Agent / Workflow 生命周期 | 保持归档；成本单价配置另列治理任务 |
| `agent-workflow-lifecycle` | done / status stale | 稳定 AgentVersion 和 WorkflowVersion | 平台持久化基础 | 可补一个 `status.md` 收敛历史状态 |
| `platform-foundation` | absorbed | 最小持久化基础 | 无 | 不继续按旧 issue 推进；以 V0.6 当前实现为准 |
| `v0.7a-identity-access` | merged-baseline | 身份、Workspace、RBAC、Reviewer 绑定和审计 | V0.6 当前闭环 | 已归并为新基线；后续按当前 master 补验收证据 |
| `v1.0-lite` | merged-baseline | 轻量可运行版统一收口 | V0.7A-V0.31F | 已归并 Lite 交付包；继续更新 PRD/验收清单 |
| `v0.24e-schema-field-picker` | ready-for-agent | 降低连线字段映射错误 | V0.24A/B/C 输入契约能力 | 可作为小切片推进，但不要替代 Data Object 主线 |
| `v0.16d-tool-skill-stable-references` | placeholder | Tool / Skill 稳定引用 | Agent 资产和权限模型 | 需要补 PRD 或删除空目录 |
| `v0.24d-schema-run-form` | placeholder | 基于 Schema 的运行表单 | Workflow inputSchema | 需要补 PRD/Issue |
| `v0.26e-artifact-schema-status` | placeholder | 产出物 Schema 状态 | Data Object / Artifact 契约 | 等 V0.8 主线确认后再拆 |
| `v0.28c-remediation-source-links` | placeholder | 补救任务来源链接 | Human Task / Remediation 模型 | 需要澄清 Remediation 是否已成领域对象 |
| `v0.29b-remediation-task-detail-api` | placeholder | 补救任务详情 API | Remediation 来源链接 | 需要与上一个功能包合并或重排 |

## 已完成归档

| 功能包 | 对应能力 | 证据 |
|---|---|---|
| `platform-foundation/issues/01-create-and-reload-agent.md` | 创建并重载 Agent | 前端 7 项、后端 3 项、Lint、Build、Playwright 通过 |
| `agent-workflow-lifecycle` | Agent 与工作流生命周期 | 两个 issue 验收标准均已勾选 |
| `real-agent-execution` | 真实 Agent 执行闭环 | Pytest、Vitest、Lint、Build、浏览器验证、DeepSeek 联调 |
| `human-collaboration-feedback` | Human Task 与反馈闭环 | 5 个 issue 全部 done；当前全量后端 34 项、前端 30 项、Lint、Build 通过 |

## 当前优先级建议

1. 以合并后的 `master` 作为新的项目基线。
2. 刷新 V1.0 Lite PRD、验收清单和当前实现文档。
3. 重排 V0.8 Data Object、V0.9 可观测性和 V0.7B 安全治理。

## 待确认问题

| 问题 | 影响 |
|---|---|
| V0.7A 是否继续按原计划补齐 7 个本地 issue？ | 影响后续 agent 是否能按 tracker 接手 |
| V0.7A 是否先从 Task 0 补 tracker，还是直接继续 Task 2 认证实现？ | 影响项目管理完整性和开发节奏 |
| V1.0 Lite 是否以已归并文档为准继续收敛？ | 影响当前版本是否能被标记为 ready-for-human |
| `v0.24*` 是否是 V0.8 Data Object 主线的一部分？ | 影响 Schema 相关功能是否合并规划 |
| Remediation 是否要成为正式领域对象？ | 影响 V0.28C/V0.29B 是否保留 |
| 是否需要把 `agent-workflow-lifecycle` 增补状态页？ | 影响历史归档可读性 |
