# 生产启动可用性恢复设计

## 1. 背景与证据

`3bd30c9` 的 Zeabur 静态资源已可访问，但 `/api/health` 持续 502；回滚 `fc59082` 后恢复。
根 Dockerfile 当前命令的 shell 语义会在后台执行整个
`bootstrap && v1_lite_seed && uvicorn`，父 shell 无论后端链是否成功都会继续启动 Nginx。

新版本还给 `rubrics` 增加了 `model_provider_id`。SQLite 有兼容补列，PostgreSQL 在
`ensure_current_schema` 中被直接跳过；对已有生产表，SQLAlchemy `create_all` 不会执行
ALTER。Seed 同时要求一个配置完整且未停用的 Provider。二者都可能阻断后端链，而当前
Nginx 会掩盖阻断结果。

## 2. 设计目标

- 旧 PostgreSQL 能以最小、幂等方式接受本次新增列。
- Provider 尚未配置时，管理员仍能进入平台完成配置。
- 显式 Seed 继续严格失败，不恢复隐式模型回退。
- 未知初始化错误必须让容器失败，不能留下“静态页正常、API 502”。
- 平台健康端点必须反映 FastAPI，而不是只反映 Nginx。

## 3. 数据库兼容策略

在 `ensure_current_schema` 的 PostgreSQL 分支只执行：

```sql
ALTER TABLE rubrics
ADD COLUMN IF NOT EXISTS model_provider_id VARCHAR(36)
```

Bootstrap 在调用 `ensure_current_schema` 前已经执行 `Base.metadata.create_all`，因此新库会先
创建完整表，旧库再通过该语句幂等补列。该分支不运行 SQLite 的重建/回填逻辑，也不扩展为
通用 PostgreSQL 迁移器。

## 4. Seed 失败分类

增加专用异常 `V1LiteModelProviderUnavailableError`。`_available_model_provider` 只在没有
符合现有安全条件的 Provider 时抛出它；其他数据库、校验或写入错误保持原异常。

CLI 新增 `--skip-if-provider-unavailable`：

- 默认不传：保持当前失败关闭语义，适用于显式 `seed-v1-lite` 操作和测试。
- 生产启动传入：只捕获上述专用异常，回滚 Session，并输出不含 Secret 的结构化
  `{"status":"skipped","reason":"model_provider_unavailable"}`。
- 任何其他异常：非零退出，阻止容器继续启动。

这样不会用 `|| true` 淹没真实故障，也不会创建不安全的占位 Provider。

## 5. 容器进程模型

根镜像使用 LF 行尾的 `scripts/start-production.sh` 作为唯一入口，按以下顺序执行：

1. `python -m app.bootstrap`
2. `python -m app.v1_lite_seed --json --skip-if-provider-unavailable`
3. 生成 Nginx 配置
4. 在受监督的后台子进程中启动 Uvicorn
5. 最多等待 30 秒，循环确认 `127.0.0.1:8000/api/health` 返回 `status=ok`
6. API 就绪后才启动默认 daemon 模式的 Nginx，并由入口进程等待 Uvicorn

`&` 只用于获得受监督的 Uvicorn PID，不再后台化 Bootstrap、Seed 或整条后端链。初始化失败、
API 提前退出或就绪超时都发生在 Nginx 开放公网端口之前；API 后续退出时，入口进程退出并停止
Nginx。该设计没有实现 Nginx/Uvicorn 的完整对称 supervisor；Nginx 运行期单独退出的检测与
服务拆分留待后续可靠性迭代。

## 6. 健康检查

Nginx `/healthz` 改为代理 `127.0.0.1:8000/api/health`。公网发布同时校验 `/healthz` 和
`/api/health`；`deployment.json` 只证明静态版本，不证明服务健康。

## 7. 测试设计

RED 测试先覆盖：

- PostgreSQL 分支必须执行唯一的定向补列，且不运行 SQLite `create_all`。
- 显式 Seed 缺 Provider 继续失败；生产启动模式结构化跳过并回滚。
- 根 Dockerfile 必须委派给唯一入口；入口必须先启动并确认 FastAPI 健康，再开放 Nginx，
  并在 API 退出时结束容器。
- `/healthz` 必须代理 API，不允许固定 200。
- Ubuntu CI 必须实际执行 `sh -n scripts/start-production.sh`，不能只依赖文本匹配。

随后运行 Seed、迁移和部署聚焦测试，再运行前后端全量、lint、build 与部署验证。当前机器
Docker Desktop 引擎未启动，因此本切片用单元/静态契约测试替代镜像运行测试；公网部署后
必须用真实健康与登录补足运行证据。

## 8. 对抗式结论

- 只改 Docker 顺序会让旧 PostgreSQL 列缺失继续阻断启动。
- 只补列会让缺 Provider 继续阻断用户进入配置页面。
- 对所有 Seed 错误 `|| true` 会隐藏数据库损坏。
- 完全删除自动 Seed 会造成服务健康但试点资产未升级的另一种错误完成感。
- 本设计保留自动尝试 Seed，并把“已完成/已跳过”作为独立证据。
- 本切片不宣称解决正式 PostgreSQL 迁移、自动回滚或高可用。
