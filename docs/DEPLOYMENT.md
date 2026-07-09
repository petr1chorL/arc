# ARC.ONE 部署说明

本文档用于把当前可运行原型部署成别人可以通过网页访问的版本。

当前项目由两部分组成：

- 前端：React + Vite，部署到 Cloudflare Pages。
- 后端：FastAPI + SQLAlchemy，部署到 Render、Railway、Fly.io 或 VPS。

不要只部署前端。当前页面会调用 `/api/*`，如果没有公网后端，页面可以打开，但 Agent、Workflow、Run、Review 等功能会失败。

## 1. 前端部署到 Cloudflare Pages

部署时可以先打开 `docs/DEPLOYMENT_VALUES.template.md`，把 Cloudflare、Render 和验收命令需要的值集中记录到你的私有笔记中。不要把填好真实密钥的版本提交到 Git。

在 Cloudflare Pages 连接 Git 仓库后，使用：

```text
Framework preset: Vite
Build command: npm run build
Build output directory: dist
```

仓库根目录也提供了 `wrangler.toml`：

```toml
name = "arc-one"
pages_build_output_dir = "./dist"
compatibility_date = "2026-07-09"
```

这用于让 Cloudflare Pages / Wrangler 明确知道 Vite 构建产物目录。

设置前端环境变量：

```text
VITE_API_BASE_URL=https://your-api.example.com
```

这个地址应填写后端公网 origin，不要带尾部 `/api`。

本地验证：

```powershell
npm run build
```

仓库已经提供两个 Cloudflare Pages 静态配置文件：

- `public/_headers`：给前端静态资源添加基础安全响应头和 CSP。
- `public/_redirects`：把直接访问 `/agents`、`/workflows` 等 React Router 路由回退到 `index.html`。

上线后建议在 Cloudflare Zero Trust 中为 Pages 域名启用 Cloudflare Access。当前应用尚未完成登录和 RBAC，不建议裸露公网访问。

## 2. 后端部署

推荐优先使用仓库根目录的 `render.yaml` 创建 Render Blueprint。它会创建：

- `arc-one-api`：FastAPI Web Service。
- `arc-one-postgres`：PostgreSQL 数据库。

创建后必须在 Render 控制台补齐这些 Secret/环境变量：

```text
ENVIRONMENT=production
ALLOWED_ORIGINS=https://your-project.pages.dev
ALLOWED_HOSTS=your-api.onrender.com
MODEL_API_KEY=<set in Render secret manager>
```

如果手动新建 Python Web Service，把服务根目录设置为：

```text
apps/api
```

构建命令：

```powershell
python -m pip install -e ".[postgres]"
```

启动命令：

```powershell
uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

如果部署平台不支持 `$PORT`，用平台提供的端口变量替换。

后端环境变量至少需要：

```text
ENVIRONMENT=production
DATABASE_URL=postgresql+psycopg://user:password@host:5432/dbname
ALLOWED_ORIGINS=https://your-project.pages.dev
ALLOWED_HOSTS=your-api.example.com
HSTS_ENABLED=true
MAX_REQUEST_BODY_BYTES=1048576
MODEL_API_KEY=<set in platform secret manager>
```

`DATABASE_URL` 也可以使用托管平台提供的 `postgres://` 或 `postgresql://` 形式；后端启动时会统一规范为 `postgresql+psycopg://`。

健康检查地址：

```text
https://your-api.example.com/api/health
```

## 3. 网络安全基线

当前已支持这些部署级安全控制：

- 前端 Cloudflare Pages `_headers`：基础安全头和 CSP。
- 前端 Cloudflare Pages `_redirects`：SPA 路由回退，避免刷新子路由 404。
- 前端 Cloudflare Pages `wrangler.toml`：声明 Pages 项目名和 `dist` 输出目录。
- `ALLOWED_ORIGINS`：限制浏览器允许访问 API 的前端来源。
- `ALLOWED_HOSTS`：拒绝异常 Host header。
- 安全响应头：`X-Content-Type-Options`、`X-Frame-Options`、`Referrer-Policy`、`Permissions-Policy`。
- `HSTS_ENABLED=true`：HTTPS 部署时启用 HSTS。
- 前端通过 `VITE_API_BASE_URL` 指向公网后端，避免把本地 `127.0.0.1` 带到生产。
- GitHub Actions CI：push 或 pull request 时自动运行测试、lint 和 build。
- Dependabot：每周检查 npm、Python/pip 和 GitHub Actions 更新，降低依赖过期风险。

重要限制：

- CORS 不是身份认证，只是浏览器侧跨域边界。
- 当前 V0.7A 只完成密码哈希和 token digest 原语，登录、Session、CSRF、完整 RBAC 尚未完成。
- 在登录权限体系完成前，不建议把真实业务数据放入公开公网原型。

如果必须让外部人员访问，建议先启用 Cloudflare Access、平台 Basic Auth、VPN 或内网访问控制，把前端和后端都放在访问控制后面。

更完整的安全清单见 `docs/SECURITY.md`。

## 4. 发布节奏

本地修改后，先运行最快的相关检查：

```powershell
npm test -- --run
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q
npm run lint
npm run deploy:check
npm run build
```

确认通过后提交并推送：

```powershell
git add .
git commit -m "Prepare hosted prototype deployment"
git push
```

Cloudflare Pages 和后端平台连接 Git 后，通常会在 push 后自动部署。

仓库也提供 `.github/workflows/ci.yml`。推送到 GitHub 后，每次 push 和 pull request 都会自动验证：

```text
npm test -- --run
python -m pytest apps/api/tests -q
npm run lint
npm run deploy:check
npm run build
```

## 5. 上线后验收

前端和后端都有公网 URL 后，运行：

```powershell
$env:FRONTEND_URL="https://your-project.pages.dev"
$env:API_URL="https://your-api.example.com"
npm run deploy:check:live
```

该命令会检查：

- 前端首页可访问。
- 前端返回基础安全头和 CSP。
- 后端 `/api/health` 返回 `{"status":"ok"}`。
- 后端返回基础安全头。
- 后端 CORS 允许配置的前端 origin。
