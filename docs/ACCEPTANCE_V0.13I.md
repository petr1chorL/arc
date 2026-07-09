# V0.13I 验收说明：Compose Worker 服务定义

> 日期：2026-06-27

## 本版完成内容

V0.13I 把 worker 从“本机命令行可启动”推进到“Compose 中可作为独立服务定义”。

- 新增 `apps/api/Dockerfile`。
- `compose.yaml` 新增 `api` 服务。
- `compose.yaml` 新增 `execution-worker` 服务。
- `api` 与 `execution-worker` 共用 `apps/api` 镜像构建上下文。
- 两个服务都通过 Compose 内的 `postgres` 和同一条 `DATABASE_URL` 工作。
- README 新增 Compose 同时启动 API 与 Worker 的命令。

## 没有完成的内容

- 本机 Docker 容器运行验证。
- Windows 服务、systemd 或进程守护。
- worker 健康检查接口。
- worker 指标面板。
- Kubernetes / Helm 部署。

## 自动化验收

### RED/GREEN 验证

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_deploy_compose.py -q
```

RED 结果：

- 首次失败，因为 `compose.yaml` 缺少 `api` / `execution-worker` 服务。
- 首次失败，因为 `apps/api/Dockerfile` 不存在。

GREEN 结果：

- 2 项通过。
- 覆盖 Compose API 服务、Worker 服务、共享构建上下文、PostgreSQL `DATABASE_URL`、依赖健康检查和 Dockerfile 默认 API 启动命令。

### Compose 配置解析

```powershell
$env:POSTGRES_PASSWORD="compose_validation_only"
docker compose config
```

实际结果：

- 命令通过。
- 配置可展开 `api`、`execution-worker` 和 `postgres` 三个服务。
- `api` 和 `execution-worker` 都使用 `apps/api/Dockerfile`。
- `execution-worker` 的命令为 `python -m app.worker --worker-id compose-worker --poll-interval 2`。

### 全量回归

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q
npm test -- --run
npm run lint
npm run build
```

实际结果：

- 后端 183 项测试通过。
- 前端 27 个测试文件、101 项测试通过。
- `npm run lint` 通过。
- `npm run build` 通过。

## 手工验收命令

具备 Docker 的环境中：

```powershell
$env:POSTGRES_PASSWORD="<通过安全渠道提供的密码>"
docker compose up --build api execution-worker
```

预期结果：

- `postgres` 健康后启动 `api`。
- `execution-worker` 作为独立服务启动并轮询队列。
- API 暴露在 `http://127.0.0.1:8000`。

当前机器 Docker CLI 可用但 Docker Desktop daemon 未运行，`docker compose build api execution-worker` 因无法连接 Docker API 未完成，因此容器构建和运行尚未在本机完成验证。
