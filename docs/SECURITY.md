# ARC.ONE 安全说明

本文记录当前公网原型已经实现的安全边界和仍需人工承担的风险。它描述的是可验证现状，
不是完整企业级安全认证。

## 当前已落地

- **同源入口：** Zeabur 根 Dockerfile 在一个容器中运行 Nginx 与 FastAPI，页面和 API
  使用同一 HTTPS 域名。
- **入口响应头：** Nginx 设置 CSP、`X-Content-Type-Options`、`X-Frame-Options`、
  `Referrer-Policy`、`Permissions-Policy` 和 HSTS。
- **请求边界：** Nginx 与 FastAPI 都限制请求体；FastAPI 还提供可信 Host、精确 Origin、
  Secure Cookie、CSRF 和固定窗口限流。
- **身份与隔离：** 登录、Session、Organization、Workspace、Membership、角色权限与
  审计事件已接入后端；关键版本查询带 Workspace 边界。
- **模型凭证：** Provider 只保存环境变量名，拒绝明文 Key；请求前校验 HTTPS 与
  `MODEL_ALLOWED_HOSTS` 精确 Host。
- **历史 Package：** Python Package 新配置已移除；历史快照只读且不在 API 进程中
  动态导入或执行。
- **远程 Agent API：** 仅允许 HTTPS、默认 443，并通过 `AGENT_API_ALLOWED_BINDINGS` 精确绑定 Workspace、Host 与 Secret Ref；响应有大小和总时限上限，不跟随重定向，也不使用环境代理。
- **CI：** GitHub Actions 运行前后端测试、lint、生产构建和部署配置校验。
- **发布来源：** Zeabur workflow 只部署通过 CI 的 `master` commit SHA；`ZEABUR_TOKEN`
  只从 GitHub Secret 读取。
- **公网证明：** workflow 先匹配公开 `deployment.json` 的 commit SHA，再检查首页、
  `/api/health`、安全响应头和 CORS。
- **依赖治理：** Dependabot 每周检查 npm、Python/pip 和 GitHub Actions 更新。

## 必配生产环境

```text
ENVIRONMENT=production
DATABASE_URL=postgresql+psycopg://<managed connection>
ALLOWED_ORIGINS=https://<application-host>
ALLOWED_HOSTS=<application-host>,localhost,127.0.0.1
HSTS_ENABLED=true
COOKIE_SECURE=true
MAX_REQUEST_BODY_BYTES=1048576
RATE_LIMIT_ENABLED=true
RATE_LIMIT_REQUESTS=120
RATE_LIMIT_WINDOW_SECONDS=60
MODEL_BASE_URL=https://api.deepseek.com
MODEL_ALLOWED_HOSTS=api.deepseek.com
MODEL_DEFAULT_MODEL=deepseek-v4-pro
AGENT_API_ALLOWED_BINDINGS=<workspace-id>@<host>=<SECRET_REF>[,...], or empty to disable
AGENT_API_MAX_RESPONSE_BYTES=1048576
```

真实模型凭证使用 Zeabur Secret/环境变量。Agent 或 Provider 记录中只允许出现相应环境
变量名。不要把密钥写入仓库、日志、截图、Issue、Pull Request 或聊天记录。
远程 Agent Manifest 同样只保存 Secret Ref 标签。API 服务和 Execution Worker 都必须配置
相同的 Workspace、目标 Host 与 Secret Ref 三元绑定及对应环境变量；绑定列表为空时默认关闭。

## 生产启动保护

`ENVIRONMENT=production` 时，FastAPI 会拒绝：

- 非 PostgreSQL 的数据库 URL。
- 通配符或非 HTTPS Origin。
- 缺少公网 Host 或使用通配符 Host。
- 未开启 HSTS、Secure Cookie 或限流。

Nginx 负责公网同源容器的响应头；FastAPI 在独立运行时仍保留应用层安全头能力，避免
不同部署形态下完全失去防线。

## GitHub 发布凭证

唯一发布凭证为 `ZEABUR_TOKEN`，只保存在 GitHub Actions Secret。项目、服务、环境 ID
和生产 URL 是 GitHub Variables。workflow 的公开 `deployment.json` 只包含 commit SHA，
不得写入 Token、环境变量、用户信息或内部资源 ID。

## 上线前检查清单

- [ ] PR 对应的 CI 全部通过。
- [ ] 目标 commit 已合并到 `master`。
- [ ] Zeabur 使用托管 PostgreSQL，不用容器本地 SQLite 承载多人数据。
- [ ] `ALLOWED_ORIGINS`、`ALLOWED_HOSTS` 与公网域名一致且不含通配符。
- [ ] HSTS、Secure Cookie、请求体限制与限流保持开启。
- [ ] 模型凭证只存在于部署平台环境变量中。
- [ ] `MODEL_ALLOWED_HOSTS` 只包含批准的精确 Host。
- [ ] `AGENT_API_ALLOWED_BINDINGS` 仅包含批准的 Workspace、Host、Secret Ref 组合；Token 只存在于 API/Worker 环境变量。
- [ ] `npm test -- --run` 通过。
- [ ] `python -m pytest apps/api/tests -q` 通过。
- [ ] `npm run lint`、`npm run deploy:check` 和 `npm run build` 通过。
- [ ] 公网 `deployment.json` 与目标完整 SHA 一致。
- [ ] `npm run deploy:check:live` 通过。
- [ ] 浏览器登录、Workspace 主页面和控制台完成检查。
- [ ] GitHub Security 页面启用依赖告警和安全更新。

## 当前风险

- 单实例服务没有自动故障转移和多区域容灾。
- 数据库备份、恢复和迁移回滚没有自动验收。
- 自动发布失败不会自动回滚应用或数据。
- 基础限流不等同于网关级 DDoS 防护。
- 对外试点仍应通过 Zeabur 或上游网关限制访问范围。

## 后续安全工作

- 建立 staging 与 production 隔离。
- 完成 PostgreSQL 备份、恢复演练和迁移治理。
- 为远程 Agent API 增加 Endpoint 资产、专用出口代理、DNS/私网策略、异步协议和资源配额。
- 增加集中日志、告警、审计导出与保留策略。
- 形成自动回滚前的数据库兼容性检查。
