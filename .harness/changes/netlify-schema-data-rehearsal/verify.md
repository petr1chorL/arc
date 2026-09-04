# Netlify Schema Baseline 与数据预演验证报告

## 环境与边界

- Netlify site：`arc-one-agentic-os`
- Preview：PR #37，最终 Deploy `6a9a510c3cbfc200082c0288`
- Production：Deploy `6a9a53c1b2196e00085ab758`，commit `2207b35c9a999946080a245586ed9b49eaad89a8`
- 业务流量：`/api/*` 仍代理 Zeabur；本 Issue 没有迁移生产业务数据。

## Schema 证据

| 项目 | 结果 |
|---|---|
| 表 | 43 |
| 列 | 524 |
| 索引 | 112 |
| UniqueConstraint | 26 |
| 物理 ForeignKey | 0，与当前 SQLAlchemy 模型一致 |
| 永久 migration | `20260904060000_create-arc-one-baseline` |

## Preview 对账

- 43 张预期表全部存在，`missingTables=[]`。
- `organizations`、`users`、`workspaces`、`workspace_memberships`、`workflow_runs`、`execution_jobs` 各 1 条合成记录。
- 六张表的主键 SHA-256 摘要与固定 manifest 一致。
- 代表性逻辑引用违规数为 0；状态分布为 `active/completed`。
- Workflow Run 汇总为 score 88、prompt 10、completion 5、total 15、cost 1.25、duration 250，与 manifest 一致。
- 连续两次读取报告完全相同，证明状态探针只读且结果稳定。
- 中间 Deploy `6a9a4f97adab54000809dca9` 因修改已执行 migration 被拒绝；恢复原 migration 并新增前向 migration 后最终通过。

## Production 验证

- Netlify Deploys 显示 `6a9a53c1b2196e00085ab758` 为 `Published / Migrations applied`。
- `/login` 返回 200。
- `/.netlify/functions/platform-health` 返回 `status=ok`、`database=ready`。
- `/api/health` 继续经 Zeabur 返回 `status=ok`。
- `schema-rehearsal-status` 未部署到 Production；该路径返回 SPA HTML，而非 JSON Function。
- PR #37 未合并并已关闭，远程临时分支已删除。

## 本地质量门禁

- API 全量：407 项通过。
- 前端全量：52 个文件、297 项通过。
- `npm run lint`：通过。
- `npm run typecheck:netlify`：通过。
- `npm run build`：通过，保留既有 chunk-size 提示。
- `git diff --check`：通过。

## 回滚与未完成项

- baseline 只新增空业务表，不切换 API 数据源；出现应用问题时业务 API 仍可由 Zeabur 提供。
- 合成 seed 与纠错 migration 只存在于已关闭的 Preview 历史中，未进入 Production。
- 生产数据、130 个业务 API、Execution Worker 与 Notification Worker 仍待后续 Issue 迁移。
- 依赖审计仍沿用 Issue 01 结论：npm advisories 网络失败，无新的 `npm audit` 通过结论。
