# V1.0 Lite 验收清单

> 当前状态：`in-progress`
> 状态复核：2026-07-11
> 自动技术验收已经跑通过一次，但真实业务方尚未按手册独立完成签收。下列必过项保持
> 未勾选，直到业务验收人逐项确认并补齐本轮证据。

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

## Codex 自动技术验收记录

- 日期：2026-06-29
- Workspace：`ai-capability-center`
- Workflow Version：`v1.0.0`
- Run ID：`db29cdef-d074-4e05-96ae-bc017633482c`
- Human Task ID：`0d870943-8175-4058-adb9-8c73bd193585`
- Evaluation ID：`a9266557-718d-4ec9-b86e-7686128caee5`
- Regression Run ID：`aa2e880e-4443-423b-a02c-9a717372c046`
- Trace ID：`trace-db29cdef-d074-4e05-96ae-bc017633482c`
- 执行人：Codex 自动验收
- 验收时间：2026-06-29
- 阻断问题：0
- 技术结论：真实服务自动链路通过。Workflow Run `已完成`，Human Task `已通过`，Evaluation `passed`，得分 86，Golden Set 样本数 3，Execution Event 数 15，Notification Outbox 数 16。
- 签收边界：该记录证明自动技术链路曾成功，不证明业务方能够按手册独立完成，不关闭上方必过项。

## 2026-07-11 收口阻断项

- [x] 使用 Python 3.12 重建可重复后端测试环境，并取得后端全量新证据。
- [x] 默认前端测试模式稳定通过，不依赖单 worker 绕开顺序相关失败。
- [x] 标准 `npm run build` 通过，不依赖替代输出目录。
- [x] Playwright 覆盖登录、Workspace 和当前核心业务路径。
- [ ] P0 运行时安全完成人工复核，可能暴露的模型 Key 已轮换。
- [ ] 由真实业务验收人填写上方证据记录并逐项勾选必过项。

工程证据：Python 3.12.13 后端 306 项通过；默认前端 43 文件 / 242 项通过；lint、
标准 build、部署检查通过；隔离登录后 Playwright 2 项通过。主包体积和依赖弃用警告
记录为后续风险，不影响本轮工程验收。
