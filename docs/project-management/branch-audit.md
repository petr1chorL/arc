# ARC.ONE 分支审计

> 审计日期：2026-07-03  
> 当前工作树：`master`  
> 发现的高级分支：`codex/v0.7a-identity-access`
> 归并状态：已在 2026-07-09 归并到 `master`

## 结论

此前项目管理文档只盘点了旧 `master` 工作树，因此低估了项目真实迭代进度。

本地分支 `codex/v0.7a-identity-access` 已经包含 V0.7A 之后的大量实现与文档，并已形成 V1.0 Lite 交付包。该分支已归并到 `master`，后续项目管理应以合并后的 `master` 为事实源。

## 分支状态

| 分支 | 状态 | 说明 |
|---|---|---|
| `master` | 当前工作树 | 已归并 V0.7A 到 V0.31F 的连续提交，以及 V1.0 Lite 文档、脚本和验收材料 |
| `codex/v0.7a-identity-access` | 已归并来源分支 | 保留为归并来源和历史审计线索 |

归并后已在 `master` 重新运行关键后端测试、`npm run lint` 和 `npm run build`。浏览器验收仍应按后续试点路径继续补证据。

## 已归并分支包含的主要能力

| 版本段 | 分支证据摘要 |
|---|---|
| V0.7A-V0.7B | 登录、Session、Workspace、RBAC、成员管理、审计、Review Workbench 验收 |
| V0.8 | Observability、成本、Human SLA、运行观测相关能力 |
| V0.9 | Evaluation、Rubric、Golden Set、Regression、评估历史与详情 |
| V0.10-V0.11 | Regression 对比、趋势、失败模式、Remediation 队列、任务、Retest 与执行事件流 |
| V0.12 | Agent Runtime、Tool/Skill 资产、HTTP Tool Adapter、LLM Judge |
| V0.13 | 异步队列、Worker、Dead Letter、Retry、Queue Operations |
| V0.14-V0.15 | Model Provider、Runtime Config、Provider 影响与迁移 |
| V0.16-V0.17 | Tool/Skill Library、生命周期、稳定引用、资产审计流 |
| V0.18-V0.19 | Workspace 审计、权限矩阵、风险提示、Trace Link Map、Run Audit Linkage |
| V0.20-V0.22 | Run rerun/resume、批量操作、操作历史、Review URL 与过滤分享链接 |
| V0.23-V0.24 | Workflow 拖拽编辑增强、Undo/Redo、IO Schema、Edge Mapping、Schema Run Form |
| V0.25-V0.27 | Data Object、Artifact Contract、Catalog、Schema Status、Artifact Deeplink 和来源上下文 |
| V0.28-V0.31 | Remediation 入口、Retest Summary、Notification Outbox、Channel Assets 与启停治理 |
| V1.0 Lite | Launch Plan、Acceptance、Runbook、E2E Acceptance、Asset Templates、Pilot Process、User/Admin Guide、启动/检查/停止脚本 |

## V1.0 Lite 分支文档

已归并分支包含以下 V1.0 Lite 相关文档：

- `docs/V1_LITE_LAUNCH_PLAN.md`
- `docs/ACCEPTANCE_V1_LITE.md`
- `docs/V1_LITE_DEPLOYMENT_RUNBOOK.md`
- `docs/V1_LITE_E2E_ACCEPTANCE.md`
- `docs/V1_LITE_ASSET_TEMPLATES.md`
- `docs/V1_LITE_PILOT_PROCESS.md`
- `docs/V1_LITE_PILOT_ISSUE_LOG.md`
- `docs/V1_LITE_USER_GUIDE.md`
- `docs/V1_LITE_ADMIN_ACCEPTANCE_GUIDE.md`
- `docs/PROJECT_ROADMAP_TO_V1.md`

## 管理动作建议

1. 以合并后的 `master` 为新的项目基线。
2. 继续刷新 `docs/CURRENT_IMPLEMENTATION.md`、`README.md` 和本目录版本台账，避免沿用旧 `master` 状态。
3. 按 V1.0 Lite 试点路径补齐浏览器验收和端到端验证证据。
