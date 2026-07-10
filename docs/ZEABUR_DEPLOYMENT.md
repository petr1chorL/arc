# ARC.ONE Zeabur 部署说明

## 当前拓扑

ARC.ONE 公网原型使用一个 **同源应用服务** 和一个 **Zeabur PostgreSQL** 服务：

```text
浏览器
  -> Zeabur 应用域名
     -> Nginx: React 静态页面
     -> Nginx /api/*: FastAPI 127.0.0.1:8000
        -> Zeabur PostgreSQL
```

应用服务从仓库根目录 `Dockerfile` 构建。前端在构建阶段执行标准 `npm run build`；
运行阶段先初始化后端和 V1 Lite 种子数据，再启动 FastAPI 与 Nginx。Nginx 统一提供
SPA 路由回退、安全响应头、请求体限制和 API 反向代理。

`apps/api/Dockerfile` 保留给本地 Compose API 与 execution worker，不是第二个公网服务。

当前公网入口：

```text
https://arc-v1-lite-lindabaoz.zeabur.app
```

健康检查：

```text
https://arc-v1-lite-lindabaoz.zeabur.app/api/health
```

期望返回：

```json
{"status":"ok"}
```

## GitHub 发布配置

`.github/workflows/deploy-zeabur.yml` 是唯一生产发布入口。它需要：

GitHub Secret：

```text
ZEABUR_TOKEN
```

GitHub Variables：

```text
ZEABUR_PROJECT_ID
ZEABUR_SERVICE_ID
ZEABUR_ENVIRONMENT_ID
ZEABUR_PRODUCTION_URL
ZEABUR_AUTO_DEPLOY
```

Zeabur Token 用于 CLI 鉴权；资源 ID 用于精确定位现有应用服务；生产 URL 用于验收；
自动发布开关决定成功的 `master` CI 是否立即进入生产发布。工作流不会读取或修改
Zeabur 服务中的数据库密码、管理员密码和模型凭证。

## Zeabur 应用环境

应用服务按 `apps/api/.env.example` 配置生产变量。关键约束：

- `DATABASE_URL` 指向 Zeabur PostgreSQL。
- `ALLOWED_ORIGINS` 和 `ALLOWED_HOSTS` 使用同一个应用域名。
- `HSTS_ENABLED`、`COOKIE_SECURE` 和 `RATE_LIMIT_ENABLED` 为 `true`。
- `MODEL_ALLOWED_HOSTS` 只列出获准接收模型凭证的精确 Host。
- 模型 Secret 只通过环境变量注入，资产保存环境变量名而不是明文值。

数据库数据卷和运行环境变量归 Zeabur 服务管理，源码发布不会覆盖它们。

## 自动发布

标准顺序：

```text
功能 worktree -> PR CI -> 合并 master -> master CI -> Zeabur -> 公网验收
```

当 `ZEABUR_AUTO_DEPLOY=true` 时，成功的 `master` CI 会触发生产 workflow。workflow
checkout CI 对应的完整 SHA，在 runner 中生成 `public/deployment.json`，再使用官方
Zeabur CLI `0.19.0` 无交互上传本地 checkout。版本固定在 workflow 中，升级 CLI
必须和普通代码变更一样经过 PR 与 CI。

Zeabur 构建是异步的，所以“CLI 已提交”不等于“新版本已上线”。workflow 会轮询：

```text
https://<application-host>/deployment.json?sha=<full-sha>
```

只有其中的 `commit` 与目标 SHA 完全相同，才执行首页和 `/api/health` 检查。这样旧版本
仍健康时不会产生错误的完成结论。

## 手动发布与回滚

GitHub Actions 的 `Deploy Zeabur` 支持手动执行：

- 留空 `commit_sha`：部署当前 `master`。
- 输入完整 SHA：部署 `master` 历史中的指定版本。

手动入口会确认该 SHA 存在成功 CI 记录。未进入 `master`、CI 失败或 GitHub 配置缺失时，
发布会在 Zeabur 上传前终止。

回滚使用同一入口重新部署上一个成功 SHA。数据库迁移不自动回滚；涉及数据结构变化时
必须先确认前后版本兼容性。

## 本地发布兜底

自动化不可用时，可以在已登录 Zeabur CLI 的受控终端，从目标 commit 的干净 checkout
执行：

```powershell
npx zeabur@latest deploy -i=false `
  --project-id <project-id> `
  --service-id <service-id> `
  --environment-id <environment-id>
```

该方式只用于紧急兜底。完成后仍需记录完整 SHA，并执行：

```powershell
$env:FRONTEND_URL="https://<application-host>"
$env:API_URL="https://<application-host>"
npm run deploy:check:live
```

## 安全提醒

当前是单服务公网原型，不具备高可用、自动数据库恢复或完整灾备能力。不要在仓库、
Actions 日志、部署文档或截图中记录真实 Secret；对外共享前应配置受控访问范围。
