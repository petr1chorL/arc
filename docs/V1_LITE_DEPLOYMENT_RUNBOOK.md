# V1.0 Lite 启动、停止与部署 Runbook

> 更新时间：2026-06-29

## 目标

让管理员可以在本机或单机服务器上启动 V1.0 Lite 试点环境，并能明确知道如何停止、重启和排查最常见问题。

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

## 验收

启动后至少验证：

- [ ] 前端首页可打开。
- [ ] API 文档可打开。
- [ ] `.\scripts\check-v1-lite.ps1` 通过。
- [ ] 可以登录或进入已配置 Workspace。
- [ ] 可以启动一次试点 Workflow。
- [ ] Execution Worker 能消费运行任务。
- [ ] Notification Worker 不报启动错误。
- [ ] 停止脚本可以关闭所有本次启动的进程。
