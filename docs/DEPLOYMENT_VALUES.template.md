# ARC.ONE Zeabur 部署参数模板

把本文件内容复制到受控的私有记录中填写。不要提交填有真实 Token、数据库连接串、
管理员密码或模型密钥的版本。

## GitHub 仓库

```text
Repository=https://github.com/<owner>/<repository>
Production branch=master
CI workflow=CI
Deployment workflow=Deploy Zeabur
```

## GitHub Actions Secret

```text
ZEABUR_TOKEN=<set in GitHub Actions secret>
```

## GitHub Actions Variables

```text
ZEABUR_PROJECT_ID=<Zeabur project id>
ZEABUR_SERVICE_ID=<same-origin application service id>
ZEABUR_ENVIRONMENT_ID=<production environment id>
ZEABUR_PRODUCTION_URL=https://<application-host>
ZEABUR_AUTO_DEPLOY=false
```

第一次手动发布和公网验收成功后，再把 `ZEABUR_AUTO_DEPLOY` 设置为 `true`。

## Zeabur 应用服务

```text
ENVIRONMENT=production
DATABASE_URL=<set from Zeabur PostgreSQL service>
ALLOWED_ORIGINS=https://<application-host>
ALLOWED_HOSTS=<application-host>,localhost,127.0.0.1
HSTS_ENABLED=true
COOKIE_SECURE=true
MAX_REQUEST_BODY_BYTES=1048576
RATE_LIMIT_ENABLED=true
RATE_LIMIT_REQUESTS=120
RATE_LIMIT_WINDOW_SECONDS=60
MODEL_API_KEY=<optional platform environment variable>
MODEL_BASE_URL=https://api.deepseek.com
MODEL_ALLOWED_HOSTS=api.deepseek.com
MODEL_DEFAULT_MODEL=deepseek-v4-pro
```

Agent 绑定其他模型凭证时，只保存环境变量名，并在 Zeabur 环境中配置对应值。

## 上线记录

```text
Merged commit SHA=<full sha>
CI run URL=<GitHub Actions run URL>
Zeabur workflow run URL=<GitHub Actions run URL>
Production URL=https://<application-host>
Public deployment marker=https://<application-host>/deployment.json
Health check=https://<application-host>/api/health
Browser acceptance=<passed / failed>
Accepted by=<name>
Accepted at=<timestamp>
```

## 本地复核命令

```powershell
$env:FRONTEND_URL="https://<application-host>"
$env:API_URL="https://<application-host>"
npm run deploy:check:live
```
