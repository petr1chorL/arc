# Netlify 原生迁移部署验证报告

## 环境

- 环境：production compatibility gate + isolated deploy preview
- Netlify site：`arc-one-agentic-os`
- Deploy ID：`6a9a3b9aea2344440fd14328`
- 源码状态：GitHub `petr1chorL/arc` 的 `codex/harness-governance` 分支，提交 `0a49e09f31788b11d21cd4f8afacae18c0522f5c`
- 业务流量：`/api/*` 仍代理 Zeabur

## 冒烟测试

| 链路 | 结果 |
|---|---|
| React 页面与 `/login` 加载 | 通过 |
| 现有 `/api/health` Zeabur 代理 | 通过，返回 `{"status":"ok"}` |
| Netlify Database health Function | 通过，返回 `{"status":"ok","database":"ready"}` |
| Database migration | 通过，`20260904023000_create-platform-probe` 已应用 |
| Async Workloads 内部 router | 通过；未认证直接访问返回 401，不再是 404 |
| Async Workloads 事件派发 | 通过；触发入口返回 202 `accepted` |
| 重复事件幂等 | 通过；`platform-gate-idempotency-v1` 完成且 `attempt_count=1` |
| 失败自动重试 | 通过；`platform-gate-retry-v1` 第 2 次尝试完成 |
| 一次性触发保护 | 通过；再次 POST 返回 `already-triggered` |
| GitHub 持续部署 | 通过；仓库、分支、命令、发布目录与 Functions 目录均已核对 |
| 浏览器刷新验收 | 通过；`/login` 正常渲染且无残留 Origin 错误，未提交凭证 |
| Deploy Preview 数据库隔离 | 通过；PR #36 / Deploy `6a9a3fbe65b65a00081b37b0` / commit `1ba685db45023d333027a7ca4d5f5c6e34525223` 的 Preview 查询包含 `preview-isolation-gate-20260904`，Production 不包含 |
| Preview 删除后的生产可用性 | 通过；关闭 PR 并删除临时分支与 Preview deploy 后，Preview URL 返回 404，生产 `/login`、`platform-health`、`/api/health` 和探针状态均返回 200 |
| PR 自动预览事件 | 通过；站点专用 GitHub webhook `674290492` 已同时订阅 `push` 与 `pull_request` |

## 本地质量门禁

- 51 个测试文件、296 项测试通过。
- 临时 Preview 分支的隔离测试先因 migration 文件缺失正确 RED，补充仅插入唯一标记的 migration 后聚焦 1 项与全量 52 个文件/297 项测试 GREEN；该临时分支未合并到生产。
- 一次完整测试曾出现 `DataObjects.test.tsx` 模拟列表为空；该文件单独复跑和随后完整复跑均通过，未改业务代码，作为既有偶发项继续观察。
- `npm run lint` 通过。
- `npm run deploy:check` 通过。
- `npm run typecheck:netlify` 通过。
- `npm run build` 通过，仅有既存的大 chunk 警告。
- `git diff --check` 通过。
- `npm audit --omit=dev --audit-level=high` 三次均因 npm advisories 网络断开/超时，无结论。

## 对抗式结论

- 这只证明 Netlify Functions、Database 与 Async Workloads 的生产平台门禁，不证明 130 个业务 API、43 张表或两个 Worker 已迁移。
- 不得关闭 Zeabur；当前 `/api/*` 仍由 Zeabur 提供，未执行真实登录提交。
- 未读取、复制或输出 Zeabur 数据库、管理员密码或模型 Secret。
- Preview 数据库隔离与删除后的生产可用性已有直接生命周期演练证据；该证据不等同于生产数据迁移或灾难恢复演练。

## 回滚预案

- 上一稳定 Netlify deploy：`6a9a370abdf0e0ccfbb64e62`。
- 当前兼容性构建没有切换业务 API；发生异常时可在 Netlify Deploys 中重新发布上一 deploy。
- Database 探针 migration 只新增独立表，不修改 Zeabur 数据或现有业务表。
- 临时 Preview migration 未合并，专用 PR、远端/本地分支与 Deploy Preview 已删除；Production 从未出现该唯一标记。

## 结论

生产平台门禁及 Preview 隔离生命周期演练已通过，Issue 01 关闭。下一步是先 Triage schema 与非生产数据演练；依赖审计仍因上游 advisories 网络问题无结论，且在 43 张业务表、130 个 API、两个 Worker 与生产数据完成迁移和独立验收前，不能切换业务流量或关闭 Zeabur。
