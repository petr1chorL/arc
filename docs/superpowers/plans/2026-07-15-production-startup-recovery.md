# 生产启动可用性恢复实施计划

**Goal:** 修复旧 PostgreSQL 兼容缺口、可恢复 Seed 前置条件和容器假健康，使生产 API 在
真实可用时才被视为上线。

**Architecture:** 保留单容器 Nginx + FastAPI 拓扑；增加一条定向 PostgreSQL 补列，Seed
仅对专用 Provider 前置条件提供显式跳过模式；由 PID 1 入口脚本先确认 FastAPI 健康，再开放
Nginx，并在 API 退出时结束容器。

## Task 1：建立 RED 回归测试

Files：

- Modify: `apps/api/tests/test_v07a_migrations.py`
- Modify: `apps/api/tests/test_v1_lite_seed.py`
- Modify: `apps/api/tests/test_deploy_compose.py`
- Modify: `scripts/check-live-deployment.test.mjs`

步骤：

1. 把原“PostgreSQL 全部跳过”测试改为断言只执行 `rubrics.model_provider_id` 定向补列。
2. 增加生产 Seed 模式缺 Provider 时结构化跳过、Session 回滚的测试，同时保留默认失败测试。
3. 增加入口脚本初始化顺序、FastAPI 就绪门槛、API 生命周期联动和 `/healthz` API 代理契约测试。
4. 增加公网验收真实请求 `/healthz` 的测试。
5. 运行上述测试并确认旧实现因目标行为缺失而失败；把失败证据追加到本地 Issue。

## Task 2：最小实现

Files：

- Modify: `apps/api/app/migrations.py`
- Modify: `apps/api/app/v1_lite_seed.py`
- Modify: `Dockerfile`
- Modify: `nginx.conf.template`
- Create: `scripts/start-production.sh`
- Modify: `scripts/check-live-deployment.mjs`
- Modify: `scripts/verify-deployment.mjs`
- Modify: `.github/workflows/ci.yml`

步骤：

1. 为 PostgreSQL 增加单条幂等补列，其他非 SQLite 数据库继续跳过。
2. 增加专用 Provider 不可用异常和 CLI 跳过开关；只捕获该异常并输出脱敏状态。
3. 用唯一入口同步执行 Bootstrap/Seed/Nginx 配置，启动 Uvicorn 并等健康后才启动 Nginx；
   入口捕获退出信号、等待 API，并在 API 退出时停止 Nginx。
4. 让 `/healthz` 代理 FastAPI，公网检查同时请求它，CI 执行 `sh -n`，并让部署验证器锁定新契约。
5. 重跑 Task 1 测试至 GREEN。

## Task 3：聚焦回归与对抗式检查

运行：

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_v07a_migrations.py apps/api/tests/test_migrations.py apps/api/tests/test_v1_lite_seed.py apps/api/tests/test_deploy_compose.py -q
npm run deploy:check
npm test -- --run scripts/check-live-deployment.test.mjs
git diff --check
```

检查默认 Seed 仍失败关闭、未知异常未被吞掉、日志不含 Secret、旧不可变版本不被改写，且
定向补列没有被描述成正式迁移体系。

## Task 4：全量验证与文档

运行：

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q
npm test -- --run
npm run lint
npm run build
npm run deploy:check
git diff --check
```

更新 `CURRENT_IMPLEMENTATION.md`、`project-overview.md`、`DEPLOYMENT.md`、
`ZEABUR_DEPLOYMENT.md`、V1 Lite 部署 Runbook、试点 Issue Log，以及相关 `.scratch` 状态。

## Task 5：发布与公网复测

1. 提交独立 PR，等待 CI 全绿后合并 `master`。
2. 部署精确合并 SHA，确认 `deployment.json` 与目标一致。
3. 分别验证 `/healthz`、`/api/health`、真实登录、关键评估节点页面和 Seed `completed/skipped` 状态。
4. 公网证据齐全后才关闭 P0；否则立即使用已知可用 SHA 回滚。
