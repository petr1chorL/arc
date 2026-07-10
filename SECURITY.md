# Security Policy

ARC.ONE 当前仍是可联网运行的企业 Agent 工作流原型，不是高可用生产系统。公网交付的
唯一支持路径是 **GitHub + Zeabur + Zeabur PostgreSQL**。不要在 Issue、Pull Request、
提交记录、日志、截图或聊天中放入密钥、Token、数据库连接串和真实业务数据。

完整安全边界和上线检查清单位于：

- `docs/SECURITY.md`
- `docs/DEPLOYMENT.md`
- `docs/DEPLOYMENT_VALUES.template.md`

## Supported Scope

仓库当前覆盖：

- GitHub Actions 前后端测试、lint、构建和部署配置校验。
- 通过 CI 的 `master` commit 才能进入 Zeabur 发布工作流。
- Nginx 同源提供 React 页面和 `/api/*` 反向代理。
- FastAPI 登录、Session、CSRF、Workspace 与权限校验。
- PostgreSQL、HTTPS Origin、可信 Host、Secure Cookie、HSTS 和限流的生产启动保护。
- 模型目标 Host 白名单以及仅接受环境变量名的模型凭证引用。
- 公开 commit 标记、首页和 `/api/health` 的部署验收。
- Dependabot 对 npm、Python/pip 和 GitHub Actions 的更新检查。

## Known Prototype Limitations

- 单应用服务，不具备多区域、高可用或自动故障转移。
- 数据库备份、恢复演练和自动迁移尚未形成生产闭环。
- Python Package 只登记元数据，隔离执行器尚未上线。
- 自动发布失败时不会自动回滚数据库或应用版本。
- 对外共享仍应配置 Zeabur 或上游网关提供的访问控制策略。

## Reporting

安全问题只通过仓库所有者控制的私密渠道报告。报告中不得附带可用凭证或客户数据；
如凭证曾出现在不受控位置，应立即轮换，而不是尝试从历史记录中隐藏风险。
