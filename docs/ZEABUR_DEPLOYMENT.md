# ARC.ONE Zeabur 部署说明

Zeabur 可以替代 Cloudflare Pages + Render，适合先把当前原型部署到一个更容易访问和配置的平台。

## 推荐服务拆分

在同一个 Zeabur Project 里创建三个服务：

- `arc-one-web`：前端静态站，仓库根目录。
- `arc-one-api`：FastAPI 后端，根目录选择 `apps/api`。
- `arc-one-postgres`：PostgreSQL 数据库。

## 前端服务

从 GitHub 导入 `petr1chorL/arc`，根目录使用仓库根目录。

仓库根目录提供 `zbpack.json`：

```json
{
  "build_command": "npm ci && npm run build:pages",
  "output_dir": "dist"
}
```

前端环境变量：

```text
VITE_API_BASE_URL=https://<zeabur-api-domain>
```

这个值不要带尾部 `/api`。构建时会根据它生成收紧后的 CSP `connect-src`。

## 后端服务

从同一个 GitHub 仓库再次创建服务，根目录选择：

```text
apps/api
```

后端目录提供 `Dockerfile`，启动命令固定为：

```text
uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}
```

后端环境变量：

```text
ENVIRONMENT=production
DATABASE_URL=<Zeabur PostgreSQL connection string>
ALLOWED_ORIGINS=https://<zeabur-web-domain>
ALLOWED_HOSTS=<zeabur-api-host>
HSTS_ENABLED=true
COOKIE_SECURE=true
MAX_REQUEST_BODY_BYTES=1048576
RATE_LIMIT_ENABLED=true
RATE_LIMIT_REQUESTS=120
RATE_LIMIT_WINDOW_SECONDS=60
MODEL_API_KEY=<set in Zeabur secret/environment variables>
MODEL_BASE_URL=https://api.deepseek.com
MODEL_DEFAULT_MODEL=deepseek-v4-pro
```

`DATABASE_URL` 可以使用 Zeabur 注入的 PostgreSQL 连接串。应用会把 `postgres://` 或 `postgresql://` 规范成 `postgresql+psycopg://`。

## PostgreSQL 服务

在 Zeabur Project 中添加 PostgreSQL 服务，然后把连接串绑定到后端服务的 `DATABASE_URL`。

不要使用本地 SQLite 承载多人访问。

## 上线验收

拿到前端和后端 URL 后，本地运行：

```powershell
$env:FRONTEND_URL="https://<zeabur-web-domain>"
$env:API_URL="https://<zeabur-api-domain>"
npm run deploy:check:live
```

验收通过后再把链接发给其他人。

## 安全提醒

当前仍是可公网演示原型，不是完整企业级权限系统。给外部人员访问前，建议使用 Zeabur 或网关层的访问控制能力限制访问范围，不要放入真实业务数据。
