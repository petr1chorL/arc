# ARC.ONE 部署说明

ARC.ONE 当前唯一支持的公网交付拓扑是 **GitHub + Zeabur + Zeabur PostgreSQL**。
Zeabur 使用仓库根目录 `Dockerfile` 构建一个同源应用服务：Nginx 提供 React 页面，
并把 `/api/*` 代理到同容器内的 FastAPI。数据库由同一 Zeabur Project 中的 PostgreSQL
服务提供。

## 标准交付流程

```text
功能分支 / worktree
-> Pull Request
-> CI
-> 合并 master
-> master CI
-> Zeabur 部署同一 commit
-> 公网验收
```

必须区分：

- `commit`：形成可追溯的本地代码快照。
- `push`：把分支同步到 GitHub，不代表公网已更新。
- `CI`：验证该 commit 的测试、lint、构建和部署配置。
- `merge`：把已审查分支纳入 `master`。
- `deploy`：把明确的 `master` commit 上传到 Zeabur。
- 公网验收：证明目标 commit 已经提供页面与 API，而不是只检查旧版本仍然健康。

## GitHub 配置

### Secret

```text
ZEABUR_TOKEN=<set in GitHub Actions secret>
```

### Variables

```text
ZEABUR_PROJECT_ID=<Zeabur project id>
ZEABUR_SERVICE_ID=<same-origin application service id>
ZEABUR_ENVIRONMENT_ID=<production environment id>
ZEABUR_PRODUCTION_URL=https://<application-host>
ZEABUR_AUTO_DEPLOY=false
```

真实值只配置在 GitHub 仓库 Settings 中，不写入仓库。第一次发布先保持
`ZEABUR_AUTO_DEPLOY=false`，使用手动工作流验收；确认成功后再改为 `true`。

## 自动部署

`.github/workflows/deploy-zeabur.yml` 监听名为 `CI` 的工作流：

1. CI 必须来自 `master` push 并成功。
2. `ZEABUR_AUTO_DEPLOY` 必须等于 `true`。
3. 自动入口要求该 SHA 仍等于当前 `origin/master`，拒绝晚完成的旧 CI 回滚新版本。
4. workflow 分别 checkout 当前发布控制代码与目标源码；手动入口只承认目标 SHA 的
   成功 `master` push CI。
5. runner 在目标源码中临时生成 `public/deployment.json`，只写入该 commit SHA。
6. 固定版本 `0.19.0` 的 Zeabur CLI 上传目标源码，不读取或修改应用运行时 Secret；
   生产发布不跟随未经验证的 `latest` 版本漂移。
7. `ZEABUR_TOKEN` 只在上传步骤可见，并在该步骤结束时注销 CLI；后续仓库脚本无法
   读取部署凭证。
8. workflow 轮询公网 `deployment.json`；只有返回目标 SHA 才继续检查首页和
   `/api/health`。这些 live check 使用有限重试容忍同一容器内静态页面与 API 的启动时序差，
   达到上限仍失败时发布任务会明确失败。

production concurrency 不会取消正在运行的发布，避免两个版本同时覆盖生产环境。

## 手动部署兜底

在 GitHub Actions 中选择 `Deploy Zeabur`，可以留空 `commit_sha` 以部署当前
`master`，也可以填写 `master` 历史中的完整 SHA 用于回滚。手动入口会查询该 SHA 的
精确匹配的 `master` push CI 记录；没有该证据的 commit 会在上传前被拒绝。

生产部署不从开发电脑直接执行 Zeabur CLI。紧急发布或回滚也使用同一个 GitHub
Actions 手动入口，使 CI、目标 SHA、Token 作用域和公网验收保持一致。

## Zeabur 运行环境

应用服务至少配置：

```text
ENVIRONMENT=production
DATABASE_URL=<Zeabur PostgreSQL connection string>
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

模型凭证只通过 Zeabur Secret/环境变量注入。Agent 或模型资产保存的是环境变量名，
不是明文 Key。生产启动会拒绝非 PostgreSQL、非 HTTPS Origin、缺少公网 Host、关闭
HSTS、关闭 Secure Cookie 或关闭限流的配置。
远程 Agent API 的 Secret Ref 对应 Token 和 `AGENT_API_ALLOWED_BINDINGS` 必须同时注入 API
服务与 Execution Worker；每项绑定使用 `<workspace-id>@<host>=<SECRET_REF>`。列表为空时默认不外呼。


根镜像入口会同步执行 Bootstrap 与 V1 Lite Seed，先启动 FastAPI 并等待本机健康接口，再开放
Nginx 公网端口。Seed 只有在缺少配置完整且未停用的 Model Provider 时会结构化跳过；数据库、
校验和其他写入错误仍会终止容器。API 就绪超时、提前退出或运行期退出也会结束容器，避免留下
静态页 200/API 502 的分裂状态。
## 合并前验证

```powershell
npm test -- --run
python -m pytest apps/api/tests -q
npm run lint
npm run deploy:check
npm run build
```

## 公网验收

自动工作流会先检查 `deployment.json` 的 commit SHA，再执行：

```powershell
$env:FRONTEND_URL="https://<application-host>"
$env:API_URL="https://<application-host>"
npm run deploy:check:live
```

该检查覆盖首页、安全响应头、代理 FastAPI 的 `/healthz`、`/api/health` 和同源 CORS。完成后还应通过浏览器检查
登录、主工作区页面、关键导航和控制台错误。

## 回滚

回滚不是点击一个不明版本的“重新部署”。在 `Deploy Zeabur` 手动工作流中填写上一个
已通过 CI 且仍属于 `master` 历史的完整 SHA。workflow 会重新生成该 SHA 的来源标记、
上传并执行同样的公网验收。

数据库兼容性必须单独判断。本阶段没有自动数据库回滚，不得用应用回滚掩盖不可逆的
数据迁移问题。

## 当前边界

该链路提供单服务原型的可追溯发布，不代表多环境、蓝绿发布、自动回滚、数据库备份
恢复或高可用已经完成。对外共享前仍应限制访问范围，不放入未经批准的真实业务数据。
