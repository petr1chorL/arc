# V1.0 Lite 最短验收入口

> 更新时间：2026-06-29
> 适用对象：试点交付负责人、管理员、业务验收人

## 目标

用最少步骤确认 ARC.ONE V1.0 Lite 是否已经具备试点交付条件。

## 第一性原理

V1.0 Lite 只证明一件事：一个真实业务团队能在受控边界内完成一次
`输入 -> Agent/Workflow -> Human Review -> Evaluation -> Observability` 闭环。

## 对抗式审查

- 自动化测试通过不等于业务方已签收。
- 页面可打开不等于试点流程已跑通。
- Noop / in_app 通知不等于真实飞书、邮件或 Webhook 已外发。
- FakeGateway 测试不等于真实模型供应商可用。
- V1.0 Lite 不承诺 Kubernetes、高可用、多组织 SaaS、计费或正式 SLO。

## 1. 自动验收

在仓库根目录执行：

```powershell
.\scripts\verify-v1-lite.ps1
```

该命令会执行：

- V1 Lite 种子资产测试。
- V1 Lite 后端端到端验收测试。
- `npm run lint`。
- `npm run build`。

如果只想验证后端闭环：

```powershell
.\scripts\verify-v1-lite.ps1 -SkipFrontend
```

## 2. 真实服务证据采集

`verify-v1-lite.ps1` 使用 FakeGateway 验证工程闭环，不访问真实模型服务。要证明
当前运行中的本地服务能产出 V1.0 Lite 签收证据，先通过安全渠道设置试点账号：

```powershell
$env:ARC_ONE_ACCEPTANCE_EMAIL="<试点账号邮箱>"
$env:ARC_ONE_ACCEPTANCE_PASSWORD="<通过安全渠道提供的密码>"
```

再执行：

```powershell
.\scripts\accept-v1-lite.ps1 -OutputPath ".scratch\runtime\v1-lite-runtime-acceptance.json"
```

如果 API 或前端使用了自定义端口：

```powershell
.\scripts\accept-v1-lite.ps1 `
  -ApiUrl "http://127.0.0.1:8010" `
  -OutputPath ".scratch\runtime\v1-lite-runtime-acceptance.json"
```

该命令会：

- 登录试点账号。
- 确认当前账号具备 Reviewer 资格。
- 启动默认 V1 Lite Workflow。
- 处理本次 Human Task。
- 创建 Evaluation Record。
- 运行 Golden Set Regression Run。
- 读取 Observability Trace 和 Notification Outbox。

输出 JSON 中必须包含 `runId`、`humanTaskId`、`evaluationId`、
`regressionRunId` 和 `traceId`。真实服务验收需要运行中的 API 已配置模型密钥，
例如 `MODEL_API_KEY` 或 Agent Provider `secretRef` 指向的环境变量；否则 Workflow
会在第一个 Agent 节点失败，不能作为 V1.0 Lite 签收证据。

## 3. 本地运行验收

启动服务：

```powershell
.\scripts\start-v1-lite.ps1
```

如果当前 worktree 没有 `apps/api/.env`，但另一个本地路径保存了真实模型配置，用
`-EnvFile` 启动。脚本只注入子进程环境，不输出、不复制密钥：

```powershell
.\scripts\start-v1-lite.ps1 -EnvFile "D:\path\to\apps\api\.env"
```

同一份 env 文件也必须用于管理员初始化和试点资产种子化，否则账号和 Workflow 可能写入另一个数据库：

```powershell
$env:ARC_ONE_ADMIN_EMAIL="<试点管理员邮箱>"
$env:ARC_ONE_ADMIN_PASSWORD="<通过安全渠道提供的密码>"
.\scripts\bootstrap-v1-lite-admin.ps1 -EnvFile "D:\path\to\apps\api\.env"
.\scripts\seed-v1-lite.ps1 -EnvFile "D:\path\to\apps\api\.env"
```

确认服务可访问：

```powershell
.\scripts\check-v1-lite.ps1
```

生成或刷新试点资产：

```powershell
.\scripts\seed-v1-lite.ps1
```

打开页面：

```text
http://127.0.0.1:4173
```

停止服务：

```powershell
.\scripts\stop-v1-lite.ps1
```

## 4. 手工业务验收

如果只想快速签收，优先按 `docs/V1_LITE_BUSINESS_ACCEPTANCE_FORM.md` 完成 10 分钟业务验收。
如果需要完整复核，再按 `docs/V1_LITE_E2E_ACCEPTANCE.md` 完成一次真实或默认试点流程，并记录：

| 证据 | 必须记录 |
|---|---|
| Workspace | 是 |
| Workflow Version | 是 |
| Run ID | 是 |
| Human Task ID | 是 |
| Evaluation ID | 是 |
| Regression Run ID | 是 |
| Trace ID | 是 |
| 业务可用性结论 | 是 |
| 阻断问题 | 是 |

## 5. 签收条件

全部满足才建议签收 V1.0 Lite：

- [ ] `.\scripts\verify-v1-lite.ps1` 通过。
- [ ] `.\scripts\start-v1-lite.ps1` 能启动。
- [ ] `.\scripts\check-v1-lite.ps1` 通过。
- [ ] `.\scripts\seed-v1-lite.ps1` 输出试点资产。
- [ ] `.\scripts\accept-v1-lite.ps1` 输出 Run ID、Human Task ID、Evaluation ID、Regression Run ID 和 Trace ID。
- [ ] `.\scripts\smoke-v1-lite-browser.ps1` 输出浏览器页面烟测证据。
- [ ] `.\scripts\audit-v1-lite-signoff.ps1` 输出 `ready_for_business_signoff`。
- [ ] 业务方完成一次端到端手工验收。
- [ ] 验收记录包含 Run ID、Human Task ID、Evaluation ID 和 Trace ID。
- [ ] 阻断问题为 0。
- [ ] 未完成能力已明确进入 V1.1+，没有被包装成 V1.0 Lite 已实现。

## 6. 失败时先看哪里

| 失败点 | 优先查看 |
|---|---|
| 自动验收失败 | 终端中的 pytest、lint 或 build 错误 |
| 页面打不开 | `.scratch/runtime/web.err.log` |
| API 打不开 | `.scratch/runtime/api.err.log` |
| Worker 不动 | `.scratch/runtime/execution-worker.err.log` |
| 通知 Worker 异常 | `.scratch/runtime/notification-worker.err.log` |
| Workflow 第一个 Agent 失败且 Token 为 0 | API 进程是否配置 `MODEL_API_KEY` 或 Provider `secretRef` 环境变量 |
| 无法处理人工审核 | Reviewer 资格、任务参与人和当前登录用户 |
| 评估无记录 | Rubric 是否 active、是否保存 Evaluation Record |
| 观测无 Trace | Run ID 是否正确、运行是否已经持久化 NodeRun |

## 7. 当前交付边界

V1.0 Lite 已提供：

- 单机/本地启动、停止、自检脚本。
- 默认试点资产种子脚本。
- 后端自动端到端验收测试。
- 真实服务验收证据采集脚本。
- 业务方用户手册。
- 管理员验收手册。
- 试点问题清单。

V1.0 Lite 不提供：

- 高可用生产部署。
- 真实外部通知全渠道接入。
- 大规模性能压测。
- 自动优化 Agent。
- 多组织 SaaS、计费或资产市场。
