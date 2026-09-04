# Netlify 原生迁移部署验证报告

## 环境

- 环境：production compatibility gate
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

## 本地质量门禁

- 51 个测试文件、296 项测试通过。
- 一次完整测试曾出现 `DataObjects.test.tsx` 模拟列表为空；该文件单独复跑和随后完整复跑均通过，未改业务代码，作为既有偶发项继续观察。
- `npm run lint` 通过。
- `npm run deploy:check` 通过。
- `npm run typecheck:netlify` 通过。
- `npm run build` 通过，仅有既存的大 chunk 警告。
- `git diff --check` 通过。
- `npm audit --omit=dev --audit-level=high` 两次均因 npm advisories 网络超时，无结论。

## 对抗式结论

- 这只证明 Netlify Functions、Database 与 Async Workloads 的生产平台门禁，不证明 130 个业务 API、43 张表或两个 Worker 已迁移。
- 不得关闭 Zeabur；当前 `/api/*` 仍由 Zeabur 提供，未执行真实登录提交。
- 未读取、复制或输出 Zeabur 数据库、管理员密码或模型 Secret。
- Preview 数据库分支和删除/失败隔离尚无直接生命周期演练证据。

## 回滚预案

- 上一稳定 Netlify deploy：`6a9a370abdf0e0ccfbb64e62`。
- 当前兼容性构建没有切换业务 API；发生异常时可在 Netlify Deploys 中重新发布上一 deploy。
- Database 探针 migration 只新增独立表，不修改 Zeabur 数据或现有业务表。

## 结论

生产平台门禁已通过；Preview 隔离直接演练和依赖审计仍未闭合，因此 Issue 保持 `in-progress`。可以继续准备 schema baseline，但不能切换业务流量或关闭 Zeabur。
