# ARC.ONE Zeabur 部署说明

当前公网原型部署在同一个 Zeabur Project 中，采用前后端拆分：

- `arc-web`：前端静态服务，公开地址为 `https://arc-web-lindabaoz.zeabur.app`。
- `arc-api-live`：FastAPI 后端服务，公开地址为 `https://arc-api-live-lindabaoz.zeabur.app`。
- PostgreSQL：Zeabur 项目内数据库服务，用于替代本地 SQLite 承载多人访问数据。

旧的 `arc-api` 服务已经删除，不再使用 `lindabaoz.zeabur.app`。

## Git 仓库

```text
https://github.com/petr1chorL/arc
```

当前 Zeabur 任意 Git 源要求使用 Dockerfile。仓库根目录不再保留 `zbpack.json`，避免 Zeabur 按纯静态站点方式构建时绕过 Dockerfile 或丢失安全响应头。

## 前端服务

服务名称：

```text
arc-web
```

公开地址：

```text
https://arc-web-lindabaoz.zeabur.app
```

前端环境变量：

```text
VITE_API_BASE_URL=https://arc-api-live-lindabaoz.zeabur.app
```

前端构建会把 API 地址写入浏览器包。修改该变量后必须重新部署前端服务。

`arc-web` 使用 Zeabur 保存的 Nginx Dockerfile 构建静态页面，并复制仓库里的 `nginx.conf.template`。这个模板负责：

- SPA 路由回退到 `index.html`。
- 设置 `X-Content-Type-Options`、`X-Frame-Options`、`Referrer-Policy`、`Permissions-Policy` 和 CSP。
- 将 CSP 的 `connect-src` 收紧到 `https://arc-api-live-lindabaoz.zeabur.app`。

## 后端服务

服务名称：

```text
arc-api-live
```

公开地址：

```text
https://arc-api-live-lindabaoz.zeabur.app
```

健康检查：

```text
https://arc-api-live-lindabaoz.zeabur.app/api/health
```

期望返回：

```json
{"status":"ok"}
```

构建目录：

```text
apps/api
```

后端 Dockerfile：

```text
apps/api/Dockerfile
```

后端服务监听 Zeabur HTTP 端口 `8080`。

后端环境变量：

```text
DATABASE_URL=<Zeabur PostgreSQL connection string>
ALLOWED_ORIGINS=https://arc-web-lindabaoz.zeabur.app
ALLOWED_HOSTS=arc-api-live-lindabaoz.zeabur.app,localhost,127.0.0.1
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

只有在 `DATABASE_URL` 和 `MODEL_API_KEY` 都配置好之后，才把下面变量打开：

```text
ENVIRONMENT=production
```

生产模式会强制检查 PostgreSQL、HTTPS、安全 Cookie、HSTS、限流和模型密钥。

## 重新部署

每次代码修改后，建议按这个顺序：

```powershell
npm run deploy:check
npm run lint
npm run build
git add <changed-files>
git commit -m "<message>"
git push origin master
```

当前 Zeabur 服务没有自动 Git trigger。推送后还需要手动或 CLI 触发部署。

重新部署前端：

```powershell
npx zeabur@latest deploy --project-id 6a4f5a4fc2881a93656ecf10 --service-id service-6a4f6911f04125ac9a33feed --environment-id 6a4f5a4f104975fcb4675e6b
```

重新部署 API：

```powershell
npx zeabur@latest deploy --project-id 6a4f5a4fc2881a93656ecf10 --service-id 6a4f8177f04125ac9a3409a3 --environment-id 6a4f5a4f104975fcb4675e6b
```

## 上线验收

本地运行：

```powershell
$env:FRONTEND_URL="https://arc-web-lindabaoz.zeabur.app"
$env:API_URL="https://arc-api-live-lindabaoz.zeabur.app"
npm run deploy:check:live
```

验收会检查：

- 前端可以访问。
- 前端安全响应头存在。
- API `/api/health` 返回 `{"status":"ok"}`。
- API CORS 只允许当前前端来源访问。

验收通过后再把前端链接发给其他人。

## 安全提醒

当前仍是公网演示原型，不是完整企业级权限系统。不要放入真实业务数据。对外共享前，优先使用 Zeabur、Cloudflare 或上游网关的访问控制能力限制访问范围。
