# Netlify 身份与 Workspace 纵切部署验证报告

## 环境与边界

- Netlify site：`arc-one-agentic-os`。
- Preview：PR #38，契约验证 Deploy `6a9a5a769f551e000987bcf5`。
- Production：最终 Deploy `6a9a63be48e4e700089e8b29`，commit
  `384eda617f38cdc5b17adc18cbd9664a4767d32f`。
- 业务流量：Production 的 `/api/*` 仍代理 Zeabur；身份数据与身份路由未切换。

## 冒烟与隔离证据

| 链路 | 结果 |
|---|---|
| Preview 身份与 Workspace API | 47 项真实 API 检查通过 |
| Preview 浏览器登录与 Workspace 进入 | 通过，使用 `.invalid` 合成账号与隔离数据库 |
| Production `/login` | 200，页面显示“登录 ARC.ONE” |
| Production 浏览器运行时 | 无白屏、无 page error；仅有预期的未登录 Session 401 |
| Production `/api/auth/session` | 401，继续由 Zeabur catch-all 提供 |
| Production 直连身份 Function | 404，伪造 `route` query 不能绕过路由白名单 |
| Production `/api/health` | 200 |
| Production Database health Function | 200 |
| Zeabur `/api/health` | 200 |

## 部署证据

- 代码 Deploy `6a9a633965b65a0008212b8c` 对应 `4f9544e`，状态 ready。
- `identity-workspace` 已作为 Node.js 24 Function 部署；Production 共 14 个 Function。
- Production 应用 `20260904133000_create-identity-rate-limits`，deploy summary 显示 1 个 migration。
- 最终文档 Deploy `6a9a63be48e4e700089e8b29` 对应 `384eda6`，状态 ready；无待执行 migration。
- 最终提交树不修改 `netlify.toml`，不含 Preview seed、Preview 账号或临时冒烟脚本。

## 本地质量门禁

- 身份纵切聚焦测试：17 项通过。
- 前端全量：52 个文件、313 项通过。
- API 全量：407 项通过。
- `npm run lint`、`npm run typecheck:netlify`、`npm run deploy:check` 与 `npm run build` 通过。
- build 仅保留既有 755.28 kB chunk-size 提示。
- `npm audit --omit=dev --audit-level=high` 因 npm advisories socket hang up 未得到结论，不能记为通过。

## 清理与保留项

- PR #38 已关闭，远端 `codex/netlify-identity-workspace` 分支已删除；本地同名分支保留为可恢复证据。
- PR 关闭后 Netlify 的历史 Preview alias 仍返回 200；其中只含合成数据且没有生产凭证。
  删除该不可变历史 Deploy 属于独立的云端破坏性操作，不影响 Production 完成判断。
- 未跟踪的 `.harness/wiki/research/` 是既有用户文件，本变更未读取、暂存或修改。

## 回滚预案

- 上一稳定 Netlify Deploy：`6a9a54e01dd08c000874f624`。
- 当前 Function 没有生产路由；应用异常时可在 Netlify Deploys 重新发布上一稳定 Deploy。
- 限流 migration 只新增独立表；回滚代码不会删除该表，如需移除必须另写前向 migration。
- Zeabur 继续承载全部业务 API，因此本切片回滚不需要切换用户流量。

## 结论

身份与 Workspace 纵切的实现、隔离 Preview、Production 休眠部署和降级链路均通过验证。
这不代表生产身份数据或流量已经迁移；在 Issue 07 完成数据对账与路由切换前不得关闭 Zeabur。
