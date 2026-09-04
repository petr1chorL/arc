---
id: H-20260904-03
status: coding
feature: .scratch/netlify-native-migration/
prd: .scratch/netlify-native-migration/PRD.md
issue: .scratch/netlify-native-migration/issues/03-identity-workspace-slice.md
design: docs/superpowers/specs/2026-09-04-netlify-identity-workspace-design.md
plan: docs/superpowers/plans/2026-09-04-netlify-identity-workspace.md
---

# 执行回执：迁移身份与 Workspace 纵切

## 当前阶段

- 阶段：coding
- 当前门禁：契约已锁定，正在按 RED/GREEN 顺序实现；未切换生产路由。

## 输入事实

- 永久 Netlify Database baseline 已存在，业务表为空。
- `/api/*` 当前全部代理 Zeabur。
- 现有前端依赖同源 Cookie、`arc_one_csrf` 与 `X-CSRF-Token`，不能拆分成跨后端 Session。

## Skill 适配说明

第三方 `coding-skill-python` 的 `{{FRAMEWORK_DESC}}` 与 `coding-skill-front` 的 `{{LINT_CMD}}`
仍为未渲染占位符，不作为命令或配置执行；本变更采用其小步 RED/GREEN 原则，实际实现以
`AGENTS.md`、项目流程、当前源码和测试为准。

## RED / GREEN 证据

待每个实现批次完成后补录。

## 交付证据

待 Preview 与 Production 验证后补录。
