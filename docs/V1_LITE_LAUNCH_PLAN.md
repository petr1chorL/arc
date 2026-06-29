# ARC.ONE V1.0 Lite 快速落地计划

> 更新时间：2026-06-29
> 目标：先让一个真实业务团队跑通试点，再把生产级能力逐步补齐。

## 第一性原理

V1.0 Lite 的目标不是一次性做完企业生产平台，而是证明 ARC.ONE 能在一个真实业务流程中稳定完成：

```text
业务输入
-> Agent/Workflow 执行
-> 结构化产出物
-> 人工审核
-> 质量评估
-> 运行观测与问题闭环
```

只要这个闭环不能被业务方独立跑通，继续扩展更多治理页面、通知渠道或高可用设施都不是当前最短路径。

## 对抗式审查

V1.0 Lite 不能被包装成完整生产版：

- 不承诺高可用、多机容灾、Kubernetes 或正式 SLO。
- 不承诺多组织 SaaS、计费、资产市场或自动优化 Agent。
- 不承诺所有外部通知渠道都接入。
- 不允许把 mock、占位、配置预检描述成真实生产能力。
- 不允许绕过 Workspace 权限、审计、密钥不落库和人工审核边界。

## 范围保留

V1.0 Lite 必须保留以下能力：

1. 登录、Workspace、角色权限和基础审计。
2. Agent 草稿、编辑、测试运行、发布版本和停用。
3. Workflow 草稿编排、发布版本、运行和运行记录。
4. Human Review 人工审核、认领、通过、驳回和反馈候选。
5. Evaluation / Rubric / Golden Set / 回归运行。
6. Observability 运行观测、Trace、失败原因和排障建议。
7. Notification Outbox 页面内运维与至少一个可配置通知渠道治理闭环。
8. 本地或单机服务器部署说明、启动/停止方式和验收清单。
9. 一个真实安克业务试点流程。

## 后置范围

以下内容推迟到 V1.1+：

- Kubernetes、Helm、Argo CD、Terraform。
- 多组织 SaaS、计费、资产市场。
- 全量 CI/CD 平台化。
- 多通知渠道全部真实接入。
- 高可用 PostgreSQL / Redis / 对象存储生命周期。
- 大规模监控告警、On-call 轮值系统。
- 自动优化 Agent、自动改写 Prompt、自动调参。
- 性能压测和正式 SLO。

## 5-7 天落地节奏

### Day 1：冻结试点范围

- 选定 1 条真实业务流程。
- 明确输入、输出、审核人、质量标准和验收样本。
- 输出：`docs/V1_LITE_PILOT_PROCESS.md`。

### Day 2：配置试点资产

- 配置试点 Agent。
- 配置试点 Workflow。
- 配置 Rubric 和 Golden Set。
- 输出：可运行的试点 Workspace 数据。

### Day 3：端到端自验

- 从输入到产出跑通一次。
- 完成人工审核。
- 保存评估记录。
- 在观测页确认 Trace、失败原因和产出物链接。

### Day 4：部署与启动闭环

- 补本机/服务器启动、停止、重启和排障说明。
- 验证 API、前端、执行 Worker、通知 Worker 能启动。
- 输出：`docs/V1_LITE_DEPLOYMENT_RUNBOOK.md`。

### Day 5：用户验收材料

- 编写业务方操作手册。
- 编写管理员验收清单。
- 修复阻断性问题。

### Day 6-7：试点陪跑与冻结

- 让业务方按手册独立跑一遍。
- 记录问题和后续迭代清单。
- 冻结 V1.0 Lite 范围。

## 版本切片

1. **V1L-A：试点流程定义**
   - 产物：试点流程文档、输入输出样例、审核标准。

2. **V1L-B：试点数据与资产模板**
   - 产物：Agent、Workflow、Rubric、Golden Set 的可复用模板。
   - 当前文档：`docs/V1_LITE_ASSET_TEMPLATES.md`。

3. **V1L-C：一键启动与部署 Runbook**
   - 产物：启动/停止脚本、环境变量说明、排障步骤。
   - 当前文档：`docs/V1_LITE_DEPLOYMENT_RUNBOOK.md`。

4. **V1L-D：端到端验收脚本**
   - 产物：从登录到运行、审核、评估、观测的验收清单。
   - 当前文档：`docs/V1_LITE_E2E_ACCEPTANCE.md`。

5. **V1L-E：试点交付包**
   - 产物：用户手册、管理员手册、问题清单、后续路线。
   - 当前文档：`docs/V1_LITE_USER_GUIDE.md`、`docs/V1_LITE_ADMIN_ACCEPTANCE_GUIDE.md`、`docs/V1_LITE_PILOT_ISSUE_LOG.md`。

## 当前下一步

优先使用 V1.0 Lite 交付包完成一次试点验收。默认试点流程仍是“AI 赋能课程内容沉淀/评审/输出”：

```text
输入：课程笔记、业务背景、目标输出类型
-> Agent 1：信息抽取与结构化
-> Agent 2：方案生成
-> Human Review：业务负责人审核
-> Evaluation：按 Rubric 评分
-> 输出：可复用的 AI 赋能方案文档
```
