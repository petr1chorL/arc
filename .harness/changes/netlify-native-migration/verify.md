# Netlify 原生迁移部署验证报告

## 环境

- 环境：production compatibility gate
- Netlify site：`arc-one-agentic-os`
- Deploy ID：`6a9a2d9aaee8b9c2da23bb46`
- 源码状态：本地未提交迁移工作树；不是 GitHub `master` 发布证明
- 业务流量：`/api/*` 仍代理 Zeabur

## 冒烟测试

| 链路 | 结果 |
|---|---|
| React 页面与 `/login` 加载 | 通过 |
| 现有 `/api/health` Zeabur 代理 | 通过，返回 `{"status":"ok"}` |
| Netlify Database health Function | 通过，返回 `{"status":"ok","database":"ready"}` |
| Database migration | 通过，`20260904023000_create-platform-probe` 已应用 |
| Async Workload 打包与部署 | 通过，线上事件重试验证待完成 |

## 本地质量门禁

- 50 个测试文件、291 项测试通过。
- `npm run lint` 通过。
- `npm run deploy:check` 通过。
- `npm run typecheck:netlify` 通过。
- `npm run build` 通过，仅有既存的大 chunk 警告。
- `git diff --check` 通过。
- `npm audit --omit=dev --audit-level=high` 两次均因 npm advisories 网络超时，无结论。

## 对抗式结论

- 这只证明 Netlify Functions 与 Database 的平台门禁，不证明 130 个业务 API、43 张表或两个 Worker 已迁移。
- 不得关闭 Zeabur；当前 Netlify 登录提交仍会被 Zeabur Origin allowlist 拒绝。
- 未读取、复制或输出 Zeabur 数据库、管理员密码或模型 Secret。

## 回滚预案

- 上一稳定 Netlify deploy：`6a9a1f30aee8b9660523bb7a`。
- 当前兼容性构建没有切换业务 API；发生异常时可在 Netlify Deploys 中重新发布上一 deploy。
- Database 探针 migration 只新增独立表，不修改 Zeabur 数据或现有业务表。

## 结论

平台门禁部分通过，可以进入 schema baseline 设计；Async Workload 线上幂等验证和依赖审计仍未闭合。
