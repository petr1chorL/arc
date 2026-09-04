---
id: H-20260904-03
status: verifying
feature: .scratch/netlify-native-migration/
prd: .scratch/netlify-native-migration/PRD.md
issue: .scratch/netlify-native-migration/issues/03-identity-workspace-slice.md
design: docs/superpowers/specs/2026-09-04-netlify-identity-workspace-design.md
plan: docs/superpowers/plans/2026-09-04-netlify-identity-workspace.md
---

# 执行回执：迁移身份与 Workspace 纵切

## 当前阶段

- 阶段：verifying
- 当前门禁：隔离 Preview 已通过，正在验证不含 seed/路由的 Production 候选；未切换生产流量。

## 输入事实

- 永久 Netlify Database baseline 已存在，业务表为空。
- `/api/*` 当前全部代理 Zeabur。
- 现有前端依赖同源 Cookie、`arc_one_csrf` 与 `X-CSRF-Token`，不能拆分成跨后端 Session。

## Skill 适配说明

第三方 `coding-skill-python` 的 `{{FRAMEWORK_DESC}}` 与 `coding-skill-front` 的 `{{LINT_CMD}}`
仍为未渲染占位符，不作为命令或配置执行；本变更采用其小步 RED/GREEN 原则，实际实现以
`AGENTS.md`、项目流程、当前源码和测试为准。

## RED / GREEN 证据

- RED 1：安全原语测试因 `security.ts` 尚不存在而失败；实现 Argon2、Token digest 与 Cookie 后转绿。
- RED 2：HTTP 契约测试因 `handler.ts` 尚不存在而失败；实现显式 route/method 白名单后转绿。
- Preview 首次冒烟发现 Netlify rewrite 保留原始 pathname，Function 误取 query route 导致 404；
  补充回归测试后改为只读取原始 pathname，并禁止直接 Function URL 伪造 route。
- 最终聚焦测试 17 项通过，覆盖跨 Python Argon2 PHC、CSRF constant-time 比对、Session idle/absolute
  过期、第五次失败登录持久提交、事务回滚与直接 Function 绕过。

## 交付证据

- PR #38 Preview deploy：`6a9a5a769f551e000987bcf5`，commit
  `312a1193b0d14efcc4be56821ee7c5d486e8d466`，状态 ready，Node.js 24。
- 真实 API 冒烟 47 项通过：登录/Session/CSRF、Workspace、成员、邀请激活、角色、Reviewer、
  Membership/User 启停、最后管理员保护、审计、改密撤销 Session、登录锁定与登出。
- Headless Chromium 浏览器通过登录并进入 `/w/arc-one-preview`，页面显示合成 Workspace 与用户。
- 未迁移 Agent API 仍到 Zeabur 并返回 401，证明 Preview 路由为精确白名单。
- 全量门禁：后端 407 项、前端 52 个文件 313 项、lint、Netlify typecheck、deploy:check 与 build 通过；
  build 仅保留既有 755.28 kB chunk warning。
- `npm audit --omit=dev --audit-level=high` 因 npm advisories socket hang up 未得到结论，不能记为通过。
- Production 候选已移除 Preview seed、身份路由与临时冒烟脚本；Production deploy 和路由隔离仍待验证。
