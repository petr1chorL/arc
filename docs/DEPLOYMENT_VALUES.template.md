# ARC.ONE 部署参数模板

复制本文件内容到你的私有记录中填写真实值。不要把填好真实密钥的版本提交到 Git。

## GitHub

```text
Repository: https://github.com/petr1chorL/arc
Branch: master
```

## Cloudflare Pages

```text
Project name: arc-one
Production branch: master
Framework preset: Vite
Build command: npm run build
Build output directory: dist
```

前端环境变量：

```text
VITE_API_BASE_URL=https://<render-api-host>
```

部署完成后记录：

```text
FRONTEND_URL=https://<cloudflare-pages-host>
```

建议访问控制：

```text
Cloudflare Access: enabled
Allowed users/groups: <your policy>
```

## Render

推荐从仓库根目录 `render.yaml` 创建 Blueprint。

创建后补齐环境变量：

```text
ENVIRONMENT=production
ALLOWED_ORIGINS=https://<cloudflare-pages-host>
ALLOWED_HOSTS=<render-api-host>
HSTS_ENABLED=true
COOKIE_SECURE=true
MODEL_API_KEY=<set in Render secret manager>
MODEL_BASE_URL=https://api.deepseek.com
MODEL_DEFAULT_MODEL=deepseek-v4-pro
```

由 Render Blueprint 自动配置：

```text
DATABASE_URL=<from arc-one-postgres connection string>
```

部署完成后记录：

```text
API_URL=https://<render-api-host>
Health check: https://<render-api-host>/api/health
```

## 上线验收

```powershell
$env:FRONTEND_URL="https://<cloudflare-pages-host>"
$env:API_URL="https://<render-api-host>"
npm run deploy:check:live
```

验收通过后再把访问链接发给其他人。
