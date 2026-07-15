# V1.0 Lite 启动、停止与部署 Runbook

> 更新时间：2026-06-29

## 目标

让管理员可以在本机或单机服务器上启动 V1.0 Lite 试点环境，并能明确知道如何停止、重启和排查最常见问题。

如果只想按最短路径验收，请先阅读 `docs/V1_LITE_ACCEPTANCE_ENTRYPOINT.md`。

## 第一性原理

V1.0 Lite 的部署目标不是高可用生产集群，而是让试点用户能稳定进入同一个可运行环境，完成一次真实业务闭环。

## 对抗式审查

- 本 Runbook 不承诺 Kubernetes、高可用、容灾或正式 SLO。
- 本 Runbook 不要求把密钥写入代码、文档或 Git。
- 启动成功只代表本机服务可访问，不代表外部模型、工具或通知供应商一定可用。

## 本地 Lite 组件

| 组件 | 默认端口 | 说明 |
|---|---:|---|
| Frontend | 4173 | Vite React 前端 |
| API | 8000 | FastAPI 后端 |
| Execution Worker | 无 | 消费执行队列 |
| Notification Worker | 无 | 消费 Notification Outbox |
| SQLite | 文件 | 默认 `apps/api/data/arc_one.db` |

## 首次准备

在仓库根目录执行：

```powershell
npm install
.\apps\api\.venv\Scripts\python.exe -m pip install -e ".\apps\api[test]"
```

如果 `apps\api\.venv` 不存在：

```powershell
python -m venv .\apps\api\.venv
.\apps\api\.venv\Scripts\python.exe -m pip install -e ".\apps\api[test]"
```

## 启动

在仓库根目录执行：

```powershell
.\scripts\start-v1-lite.ps1
```

如果当前 worktree 没有 `apps/api/.env`，但模型密钥保存在另一个本地 env 文件里，可以显式指定：

```powershell
.\scripts\start-v1-lite.ps1 -EnvFile "D:\path\to\apps\api\.env"
```

`-EnvFile` 只会在启动 API 与 Worker 子进程前把变量注入当前 PowerShell 进程，启动完成后恢复原环境；
它不会把密钥写入 Git、日志或运行证据。

如果使用 `-EnvFile` 启动服务，管理员初始化和种子化也要使用同一个 env 文件：

```powershell
$env:ARC_ONE_ADMIN_EMAIL="<试点管理员邮箱>"
$env:ARC_ONE_ADMIN_PASSWORD="<通过安全渠道提供的密码>"
.\scripts\bootstrap-v1-lite-admin.ps1 -EnvFile "D:\path\to\apps\api\.env"
.\scripts\seed-v1-lite.ps1 -EnvFile "D:\path\to\apps\api\.env"
```

## 种子化试点资产

首次启动前或试点资产被清空后，执行：

```powershell
.\scripts\seed-v1-lite.ps1
```

worktree 或自定义数据库场景：

```powershell
.\scripts\seed-v1-lite.ps1 -EnvFile "D:\path\to\apps\api\.env"
```

脚本要求目标 Workspace 所属组织已经存在 active 管理员账号。脚本会写入默认数据库 `apps/api/data/arc_one.db`，并输出 Workspace、Reviewer、Agent、Workflow、Rubric、Golden Set 和通知渠道 ID。它只保存非密钥配置，不读取或输出 API Key。

如果使用自定义数据库：

```powershell
.\scripts\seed-v1-lite.ps1 -DatabaseUrl "sqlite:///D:/path/to/arc-one.db"
```

## 模型密钥前置条件

`verify-v1-lite.ps1` 使用 FakeGateway，不需要真实模型密钥。真实服务验收和页面手工运行
会调用 OpenAI-compatible ModelGateway，因此运行 API 的进程必须能读到模型密钥：

- 使用全局模型配置时，配置 `MODEL_API_KEY`。
- 使用 Agent Provider 时，配置该 Provider 的 `secretRef` 对应环境变量。

密钥只能通过 `.env`、系统环境变量或部署平台 Secret 注入；不要写入 Git、文档、截图或
运行证据 JSON。若 Workflow 在第一个 Agent 节点失败且 Token 为 0，优先检查运行中的 API
进程是否拿到了这些环境变量。

在 worktree 场景中，后端默认只读取当前 worktree 的 `apps/api/.env`。如果密钥保存在主仓库或其他
本地路径，请用 `start-v1-lite.ps1 -EnvFile "<本地 env 路径>"` 启动。

启动后访问：

```text
http://127.0.0.1:4173
```

API 文档：

```text
http://127.0.0.1:8000/docs
```

脚本会把 PID 和日志写入：

```text
.scratch/runtime/
```

## 自检

```powershell
.\scripts\check-v1-lite.ps1
```

完整自动验收：

```powershell
.\scripts\verify-v1-lite.ps1
```

真实服务证据采集：

```powershell
$env:ARC_ONE_ACCEPTANCE_EMAIL="<试点账号邮箱>"
$env:ARC_ONE_ACCEPTANCE_PASSWORD="<通过安全渠道提供的密码>"
.\scripts\accept-v1-lite.ps1 -OutputPath ".scratch\runtime\v1-lite-runtime-acceptance.json"
```

如果使用自定义 API 端口：

```powershell
.\scripts\accept-v1-lite.ps1 `
  -ApiUrl "http://127.0.0.1:8010" `
  -OutputPath ".scratch\runtime\v1-lite-runtime-acceptance.json"
```

自检会验证：

- 前端页面是否可访问。
- API 文档是否可访问。
- `start-v1-lite.ps1` 管理的进程是否仍在运行。

## 停止

```powershell
.\scripts\stop-v1-lite.ps1
```

## 重启

```powershell
.\scripts\stop-v1-lite.ps1
.\scripts\start-v1-lite.ps1
```

## 常见问题

### 端口被占用

改端口启动：

```powershell
.\scripts\start-v1-lite.ps1 -ApiPort 8010 -WebPort 5173
```

### 页面打不开

检查：

```powershell
Get-Content .scratch\runtime\web.err.log -Tail 80
Get-Content .scratch\runtime\api.err.log -Tail 80
```

### API 启动失败

优先检查：

- Python 虚拟环境是否存在。
- 依赖是否安装。
- `apps/api/data/arc_one.db` 是否可写。
- 日志 `.scratch/runtime/api.err.log` 和 `.scratch/runtime/api.out.log`。

### Worker 没处理任务

检查：

```powershell
Get-Content .scratch\runtime\execution-worker.err.log -Tail 80
Get-Content .scratch\runtime\notification-worker.err.log -Tail 80
```

## 单机服务器试点

V1.0 Lite 可先用本地脚本或 Compose 单机部署。Compose 路径仍需要 Docker daemon 可用：

```powershell
$env:POSTGRES_PASSWORD="<通过安全渠道提供的密码>"
docker compose up --build api execution-worker notification-worker
```

当前 Runbook 的默认推荐仍是本地 Lite 脚本，因为它更适合快速验收和问题定位。

## Zeabur 同源部署

公网试点建议使用仓库根目录的 `Dockerfile` 部署为单个 Web 服务：

- Nginx 负责前端静态文件。
- Nginx 将 `/api/` 反代到同容器内的 FastAPI。
- 启动时先执行管理员初始化与 V1 Lite 种子资产写入，再启动 FastAPI。
- FastAPI 本机健康检查通过后才开放 Nginx 公网端口；API 退出会结束容器。

这种同源部署是登录、Session Cookie 和 CSRF 的推荐方式。不要把前端和 API 放在不同
子域名上承载 V1 Lite 登录版，否则浏览器无法从前端域名读取 API 域名下的 CSRF Cookie。

Zeabur 服务环境变量：

```text
DATABASE_URL=<Zeabur PostgreSQL connection string>
ALLOWED_ORIGINS=https://arc-v1-lite-lindabaoz.zeabur.app
COOKIE_SECURE=true
ARC_ONE_ADMIN_EMAIL=<pilot admin email>
ARC_ONE_ADMIN_PASSWORD=<set in Zeabur secret/environment variables>
ARC_ONE_ADMIN_DISPLAY_NAME=V1 Lite Browser Admin
MODEL_API_KEY=<set in Zeabur secret/environment variables, optional for page browsing>
MODEL_BASE_URL=https://api.deepseek.com
MODEL_ALLOWED_HOSTS=api.deepseek.com
MODEL_DEFAULT_MODEL=deepseek-v4-pro
AGENT_API_ALLOWED_BINDINGS=<workspace-id>@agent.example.com=RESEARCH_AGENT_API_TOKEN
AGENT_API_MAX_RESPONSE_BYTES=1048576
RESEARCH_AGENT_API_TOKEN=<set in Zeabur secret/environment variables>
```

`ARC_ONE_ADMIN_PASSWORD`、`MODEL_API_KEY` 和远程 Agent 的实际 Token 只能通过部署平台
Secret 或环境变量注入，不得写入代码、文档、截图或日志。多组远程绑定用英文逗号分隔；
列表为空即关闭远程 Agent 外呼。`AGENT_API_ALLOWED_BINDINGS` 与其中引用的 Secret 必须
以相同值注入 API 和 Execution Worker。

若启动日志中的 Seed 结果为 `model_provider_unavailable`，平台会保持可登录，但试点评估资产
尚未完成升级。管理员应先在“模型资产”配置一个完整、未停用的 Provider，并确保其 Secret Ref
对应环境变量已安全注入；随后重启服务让入口自动重试，或在受控环境中显式执行
`scripts/seed-v1-lite.ps1`。只有 Seed 返回 `completed` 或显式脚本成功，才能把试点资产视为
已就绪。其他 Seed、Bootstrap 或数据库错误仍会终止容器。

## 验收

启动后至少验证：

- [ ] 前端首页可打开。
- [ ] `/healthz` 与 `/api/health` 均返回 `{"status":"ok"}`。
- [ ] API 文档可打开。
- [ ] `.\scripts\check-v1-lite.ps1` 通过。
- [ ] 启动 Seed 状态为 `completed`，或 `skipped` 后已配置 Provider 并完成重试。
- [ ] `.\scripts\seed-v1-lite.ps1` 已成功输出试点资产。
- [ ] `.\scripts\accept-v1-lite.ps1` 已成功输出 Run ID、Human Task ID、Evaluation ID、Regression Run ID 和 Trace ID。
- [ ] 可以登录或进入已配置 Workspace。
- [ ] 可以启动一次试点 Workflow。
- [ ] Execution Worker 能消费运行任务。
- [ ] Notification Worker 不报启动错误。
- [ ] 停止脚本可以关闭所有本次启动的进程。
