# ARC.ONE 安全说明

本文档记录当前可公网演示原型的安全边界。它不是完整企业级安全方案；登录、Session、CSRF、Workspace、RBAC 和审计闭环仍属于后续 V0.7/V1 范围。

## 当前已落地

- 前端部署安全头：`public/_headers` 设置 `X-Content-Type-Options`、`X-Frame-Options`、`Referrer-Policy`、`Permissions-Policy` 和基础 CSP。
- SPA 路由回退：`public/_redirects` 避免刷新子路由时暴露错误页面。
- Cloudflare Pages 配置：`wrangler.toml` 声明项目名和 `dist` 输出目录。
- 前端 API 基址：`VITE_API_BASE_URL` 控制生产 API origin，避免生产环境误连本机地址。
- 后端 CORS allowlist：`ALLOWED_ORIGINS` 只允许指定前端 origin 从浏览器访问 API。
- 后端 Host allowlist：`ALLOWED_HOSTS` 拒绝异常 Host header。
- 后端安全响应头：FastAPI 返回基础安全头；HTTPS 部署时可开启 `HSTS_ENABLED=true`。
- 请求体限制：`MAX_REQUEST_BODY_BYTES` 默认限制为 1MB，超限请求在入口层返回 `413`。
- 健康检查：`/api/health` 用于部署平台探活。
- CI 验证：GitHub Actions 会运行前端测试、后端测试、lint 和 build。
- 依赖更新：Dependabot 每周检查 npm、Python/pip 和 GitHub Actions 更新。

## 必配生产环境变量

前端：

```text
VITE_API_BASE_URL=https://your-api.example.com
```

后端：

```text
ENVIRONMENT=production
DATABASE_URL=postgresql+psycopg://user:password@host:5432/dbname
ALLOWED_ORIGINS=https://your-project.pages.dev
ALLOWED_HOSTS=your-api.example.com
HSTS_ENABLED=true
COOKIE_SECURE=true
MAX_REQUEST_BODY_BYTES=1048576
MODEL_API_KEY=<set in platform secret manager>
```

不要把真实密钥写入仓库、日志、截图、Issue 或聊天记录。

## 公网演示建议

当前原型尚未具备真实登录和权限控制。给外部人员访问前，至少使用一种外层访问控制：

- Cloudflare Access。
- 部署平台 Basic Auth 或访问密码。
- VPN / 内网访问。
- 临时演示域名加短期有效访问策略。

只配置 CORS 不等于保护 API。非浏览器客户端仍然可以直接请求公开 API。

## 上线前检查清单

- [ ] Cloudflare Pages 设置了 `VITE_API_BASE_URL`。
- [ ] 后端设置了 `ENVIRONMENT=production`。
- [ ] 后端设置了精确的 `ALLOWED_ORIGINS`，不使用 `*`。
- [ ] 后端设置了精确的 `ALLOWED_HOSTS`。
- [ ] 后端使用 PostgreSQL，不使用本地 SQLite 承载多人访问。
- [ ] `MODEL_API_KEY` 只存在于平台 Secret Manager。
- [ ] `HSTS_ENABLED=true` 只在 HTTPS 域名可用后开启。
- [ ] 前端和后端都被 Cloudflare Access 或等价机制保护。
- [ ] `npm test -- --run` 通过。
- [ ] `python -m pytest apps/api/tests -q` 通过。
- [ ] `npm run lint` 通过。
- [ ] `npm run deploy:check` 通过。
- [ ] `npm run build` 通过。
- [ ] 部署完成后设置 `FRONTEND_URL` 和 `API_URL`，运行 `npm run deploy:check:live` 通过。
- [ ] GitHub Security 页面启用 Dependabot alerts 和 Dependabot security updates。

## 后续安全工作

- 登录、Session cookie、CSRF 双提交或等价防护。
- User、Organization、Workspace、Membership 和 RBAC。
- API 级授权检查，而不是只依赖页面隐藏按钮。
- 审计事件查询、导出和保留策略。
- 请求限流、后台任务隔离和模型调用配额。
- 数据库迁移工具和备份/恢复流程。
- 更严格的 CSP：在最终域名确定后，把 `connect-src` 从通配 HTTPS 收紧到确切 API origin。

## 生产启动保护

当后端设置 `ENVIRONMENT=production` 时，应用启动会拒绝以下配置：

- `DATABASE_URL` 不是 PostgreSQL。
- `ALLOWED_ORIGINS` 没有 HTTPS origin。
- `ALLOWED_HOSTS` 没有公网 API host。
- `HSTS_ENABLED` 不是 `true`。
- `COOKIE_SECURE` 不是 `true`。
- `MODEL_API_KEY` 未设置。

这层保护用于防止把本地开发默认配置误部署到公网。

部署平台提供的 `postgres://`、`postgresql://` 和 `postgresql+psycopg://` 都按 PostgreSQL 处理；运行时会使用 `psycopg` 驱动。
