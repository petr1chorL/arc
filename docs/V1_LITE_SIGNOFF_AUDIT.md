# V1.0 Lite 签收审查报告

> 更新时间：2026-06-29
> 目的：从第一性原理和对抗式审查出发，说明 V1.0 Lite 当前哪些事项已有证据、哪些仍需业务方人工确认、哪些明确不属于 V1.0 Lite。

## 第一性原理

V1.0 Lite 只证明一件事：一个真实业务团队能在受控边界内完成一次
`输入 -> Agent/Workflow -> Human Review -> Evaluation -> Observability` 闭环。

它不是完整生产版，也不承诺高可用、多组织 SaaS、全量外部通知、自动优化 Agent 或正式 SLO。

## 对抗式审查

- 不能用 FakeGateway 自动测试替代真实模型服务验收。
- 不能用页面可打开替代业务流程可完成。
- 不能用 Noop / in_app 通知替代真实飞书、邮件或 Webhook 外发。
- 不能把需要业务方判断的可用性结论伪造成 Codex 已签收。
- 不能记录密钥、Token、私钥、`.env` 值或客户敏感原文。

## 当前结论

技术侧 V1.0 Lite 已具备试点签收证据；业务侧仍需要验收人按手册独立点一遍并填写结论。

| 范围 | 结论 | 证据 |
|---|---|---|
| 自动工程验收 | 通过 | `.\scripts\verify-v1-lite.ps1` 通过，覆盖后端 V1 Lite E2E、lint、build |
| 本地服务可用 | 通过 | `.\scripts\check-v1-lite.ps1` 通过，Frontend/API/Execution Worker/Notification Worker 均运行 |
| 浏览器页面烟测 | 通过 | `.scratch/runtime/v1-lite-browser-smoke.json`，7 个关键页面可打开，`severeMessages=[]`，`badResponses=[]` |
| 真实服务闭环 | 通过 | `.\scripts\accept-v1-lite.ps1` 输出完整证据 JSON |
| 签收审查脚本 | 通过 | `.\scripts\audit-v1-lite-signoff.ps1` 汇总校验技术证据，输出 `ready_for_business_signoff` |
| 阻断问题 | 0 | `docs/V1_LITE_PILOT_ISSUE_LOG.md` 中 V1L-ISSUE-001 已关闭 |
| 业务方独立验收 | 待人工确认 | 建议先按 `docs/V1_LITE_BUSINESS_ACCEPTANCE_FORM.md` 做 10 分钟验收；完整手册见 `docs/V1_LITE_E2E_ACCEPTANCE.md` 和 `docs/V1_LITE_ADMIN_ACCEPTANCE_GUIDE.md` |

## 真实服务验收证据

证据文件：`.scratch/runtime/v1-lite-runtime-acceptance.json`

| 字段 | 值 |
|---|---|
| Status | `passed` |
| Workspace | `ai-capability-center` |
| Workflow Version | `v1.0.0` |
| Run ID | `db29cdef-d074-4e05-96ae-bc017633482c` |
| Run Status | `已完成` |
| Human Task ID | `0d870943-8175-4058-adb9-8c73bd193585` |
| Human Task Status | `已通过` |
| Evaluation ID | `a9266557-718d-4ec9-b86e-7686128caee5` |
| Evaluation Status | `passed` |
| Evaluation Score | `86` |
| Regression Run ID | `aa2e880e-4443-423b-a02c-9a717372c046` |
| Regression Samples | `3` |
| Trace ID | `trace-db29cdef-d074-4e05-96ae-bc017633482c` |
| Execution Event Count | `15` |
| Notification Outbox Count | `16` |

## 浏览器烟测证据

证据文件：`.scratch/runtime/v1-lite-browser-smoke.json`

可重复生成命令：

```powershell
$env:ARC_ONE_BROWSER_SMOKE_EMAIL="<试点账号邮箱>"
$env:ARC_ONE_BROWSER_SMOKE_PASSWORD="<通过安全渠道提供的密码>"
.\scripts\smoke-v1-lite-browser.ps1 `
  -WebUrl "http://127.0.0.1:54173" `
  -RunId "db29cdef-d074-4e05-96ae-bc017633482c" `
  -OutputPath ".scratch\runtime\v1-lite-browser-smoke.json"
```

| 页面 | 期望文本 | 结果 |
|---|---|---|
| `/w/ai-capability-center` | `运营总览` | 通过 |
| `/w/ai-capability-center/agents` | `Agent` | 通过 |
| `/w/ai-capability-center/workflows` | `工作流` | 通过 |
| `/w/ai-capability-center/evaluations` | `评估` | 通过 |
| `/w/ai-capability-center/reviews` | `人工审核` | 通过 |
| `/w/ai-capability-center/observability?runId=db29cdef-d074-4e05-96ae-bc017633482c` | `运行观测` | 通过 |
| `/w/ai-capability-center/notifications` | `通知` | 通过 |

浏览器烟测中 `severeMessages=[]`，`badResponses=[]`。登录前会话探测产生的 401 已单独归类为 `authProbeMessages`，不视为页面失败。

## 一键签收审查

运行：

```powershell
.\scripts\audit-v1-lite-signoff.ps1 -OutputPath ".scratch\runtime\v1-lite-signoff-audit.json"
```

该脚本只读取以下非密钥证据：

- `.scratch/runtime/v1-lite-runtime-acceptance.json`
- `.scratch/runtime/v1-lite-browser-smoke.json`
- `docs/V1_LITE_PILOT_ISSUE_LOG.md`

当技术证据齐全且无 P0/P1 阻断项时，脚本输出 `status=ready_for_business_signoff`。该状态不等于业务方已经签收，只表示可以进入人工签收。

## 签收材料包

导出一份给业务验收人阅读和填写的 Markdown 材料包：

```powershell
.\scripts\export-v1-lite-signoff-package.ps1
```

默认输出：`.scratch/runtime/v1-lite-signoff-package.md`

材料包会汇总真实服务闭环、浏览器烟测、签收审查、问题清单和业务验收填写区。它不读取 `.env`，不输出密钥。

## 签收条件逐项审查

| 条件 | 状态 | 证据或说明 |
|---|---|---|
| 可以用真实账号登录并进入目标 Workspace | 已证实 | 真实服务验收脚本完成登录并读取 Workspace |
| 试点 Agent 已配置并发布版本 | 已证实 | `seed-v1-lite.ps1` 输出 4 个 Agent，版本 `v1.0.0` |
| 试点 Workflow 已配置并发布版本 | 已证实 | Workflow `AI 赋能方案 V1.0 Lite 试点工作流`，版本 `v1.0.0` |
| Workflow 可用样例输入启动运行 | 已证实 | Run `db29cdef-d074-4e05-96ae-bc017633482c` 已完成 |
| 运行能生成结构化产出物 | 已证实 | Run 进入人工审核并完成下游 Agent 修订 |
| Human Review 能认领并提交审核决定 | 已证实 | Human Task `0d870943-8175-4058-adb9-8c73bd193585` 状态 `已通过` |
| Evaluation 能评分并保存记录 | 已证实 | Evaluation `a9266557-718d-4ec9-b86e-7686128caee5`，得分 86 |
| Golden Set 可用于复测 | 已证实 | Regression Run `aa2e880e-4443-423b-a02c-9a717372c046`，样本数 3 |
| Observability 能看到 Trace 和节点结果 | 已证实 | Trace `trace-db29cdef-d074-4e05-96ae-bc017633482c`，事件数 15 |
| 通知 Outbox 有页面内运维记录 | 已证实 | Notification Outbox 数 16 |
| 管理员能按说明启动、停止、重启 | 部分证实 | 启动、自检已证实；停止脚本此前已可关闭本次脚本启动进程，仍建议验收人手工点一次 |
| 业务方能按手册独立完成端到端验收 | 待人工确认 | 这一步必须由业务验收人确认，Codex 不代签 |

## 后置到 V1.1+

以下不作为 V1.0 Lite 阻断项：

- Kubernetes 高可用与生产 SLO。
- 多组织 SaaS、计费、资产市场。
- 全量真实外部通知渠道。
- 飞书文档自动读取。
- Agent 自动优化。
- 大规模性能压测。
- 自动生成正式验收报告。

## 建议签收动作

1. 打开当前服务地址，完成一次页面级手工验收。
2. 优先按 `docs/V1_LITE_BUSINESS_ACCEPTANCE_FORM.md` 填写业务验收表。
3. 在 `docs/ACCEPTANCE_V1_LITE.md` 填写业务方验收记录。
4. 若出现 P0/P1 问题，记录到 `docs/V1_LITE_PILOT_ISSUE_LOG.md`，修复并复测后再签收。
5. 若只是增强项，放入 V1.1+ 候选，不阻断 V1.0 Lite。
