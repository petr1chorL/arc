# ARC.ONE 当前迭代 Backlog

> 更新时间：2026-07-11
> 原则：停止按细版本编号惯性扩功能，先完成 V1.0 Lite 收口与业务签收。

## 当前队列

| 优先级 | 工作包 | 状态 | 完成信号 |
|---|---|---|---|
| P0 | 项目事实收敛 | completed | 项目定位、源码盘点、台账、路线图和验收口径一致 |
| P0 | 可重复验证环境 | ready-for-human | Python 3.12 后端测试、默认前端测试、标准 build 和登录 E2E 同轮通过，待审阅改动 |
| P0 | 运行时安全人工签收 | ready-for-human | 人工复核四条安全边界，完成可能暴露 Key 的轮换 |
| P0 | V1.0 Lite 真实业务验收 | ready-for-human | 业务方独立跑通闭环并勾选全部必过项 |
| P1 | 试点问题修复 | pending pilot | P0/P1 问题关闭，P2/P3 有负责人和版本 |
| P1 | 下一产品主线选择 | pending pilot | 根据真实试点证据选择可靠性治理或一个真实外部集成 |

## 当前阻断事实

- 可重复工程验证已恢复：后端 306 项、默认前端 242 项、lint、标准 build、部署检查和
  登录后 Playwright 2 项同轮通过。
- P0 安全仍待人工审阅和可能暴露 Key 的轮换。
- V1.0 Lite 自动技术验收存在，但业务方独立验收尚未完成。
- 主前端包约 717 KB，FastAPI TestClient 依赖层有弃用警告；均为已记录非阻断风险。

## 已归档能力

V0.2-V0.31F 已进入当前 `master` 基线。旧 `.scratch` 中的 `placeholder`、
`ready-for-agent` 或归并前状态不再作为这些能力是否存在的判断依据；具体边界以
`docs/project-management/project-overview.md`、Acceptance、源码和测试为准。

历史能力包括：

- Agent / Workflow 生命周期、版本快照和运行。
- Human Task、反馈候选、Golden Sample、Evaluation 和 Regression。
- 身份、Workspace、固定 RBAC、成员、Reviewer 和审计。
- Agent Runtime、Tool/Skill、Model Provider、异步队列和 Worker。
- Trace、Run 操作、Data Object、Artifact 和 Remediation。
- Notification Outbox、渠道治理与 V1.0 Lite 交付包。

## 暂不进入开发

- 新的细版本页面或运营卡片。
- 未绑定真实试点需求的 MCP、通知渠道或资产市场扩展。
- 自动优化 Agent、自动改 Prompt 或自动调参。
- Kubernetes、多组织 SaaS、计费和大规模平台化。
- 没有失败测试或业务证据支撑的大型重构。

## 下一决策门

只有 V1.0 Lite 业务验收完成后，才根据证据选择：

1. **可靠性主线**：PostgreSQL 正式迁移、备份恢复、队列并发安全、实时观测和 SLO。
2. **业务价值主线**：选择一个明确的真实数据源或通知渠道，完成权限、安全、失败和审计闭环。

未达到决策门前，不恢复旧路线中“下一步进入某个 V0.x”的线性推进方式。
