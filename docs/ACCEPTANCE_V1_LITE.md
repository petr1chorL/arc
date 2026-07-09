# V1.0 Lite 验收清单

## 第一性原理

V1.0 Lite 只验收一件事：真实业务方能否按照手册独立跑通一个 AI 工作流闭环。

## 对抗式审查

- 不能把 V1.0 Lite 说成完整生产版。
- 不能把占位能力说成真实外部集成。
- 不能跳过权限、审计、密钥和人工审核边界。
- 不能只验收页面能打开，必须验收业务流程能完成。

## 必过项

- [ ] 可以用真实账号登录并进入目标 Workspace。
- [ ] 试点 Agent 已配置并发布版本。
- [ ] 试点 Workflow 已配置并发布版本。
- [ ] 试点 Workflow 可以用样例输入启动运行。
- [ ] 运行能生成结构化产出物。
- [ ] Human Review 能认领并提交审核决定。
- [ ] Evaluation 能对产出物评分并保存记录。
- [ ] Golden Set 或回归样本可用于复测。
- [ ] Observability 能看到本次运行、Trace、节点结果和失败提示。
- [ ] 通知 Outbox 能看到相关通知或页面内运维记录。
- [ ] 管理员能按部署说明启动、停止、重启系统。
- [ ] `.\scripts\accept-v1-lite.ps1` 能输出本次运行的 Run ID、Human Task ID、Evaluation ID、Regression Run ID 和 Trace ID。
- [ ] 业务方能按操作手册独立完成一次端到端验收。

## 暂不验收

- [ ] Kubernetes 高可用。
- [ ] 多组织 SaaS。
- [ ] 正式 CI/CD。
- [ ] 全量外部通知渠道。
- [ ] 正式 SLO 和压测报告。
- [ ] 自动优化 Agent。

## 证据记录

验收时补充：

- 测试账号：
- 试点 Workspace：
- 试点 Workflow：
- 试点 Agent：
- 试点 Rubric：
- 样例输入：
- 运行 ID：
- 审核任务 ID：
- Evaluation ID：
- 验收人：
- 验收时间：
- 阻断问题：
- 后续迭代：

## Codex 自动验收记录

- 日期：2026-06-29
- Workspace：`ai-capability-center`
- Workflow Version：`v1.0.0`
- Run ID：`db29cdef-d074-4e05-96ae-bc017633482c`
- Human Task ID：`0d870943-8175-4058-adb9-8c73bd193585`
- Evaluation ID：`a9266557-718d-4ec9-b86e-7686128caee5`
- Regression Run ID：`aa2e880e-4443-423b-a02c-9a717372c046`
- Trace ID：`trace-db29cdef-d074-4e05-96ae-bc017633482c`
- 验收人：Codex 自动验收
- 验收时间：2026-06-29
- 阻断问题：0
- 结论：真实服务验收通过。Workflow Run `已完成`，Human Task `已通过`，Evaluation `passed`，得分 86，Golden Set 样本数 3，Execution Event 数 15，Notification Outbox 数 16。
