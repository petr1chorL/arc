---
id: H-20260904-02
status: testing
feature: .scratch/netlify-native-migration/
prd: .scratch/netlify-native-migration/PRD.md
issue: .scratch/netlify-native-migration/issues/02-schema-and-data-rehearsal.md
design: docs/superpowers/specs/2026-09-04-netlify-schema-data-rehearsal-design.md
plan: docs/superpowers/plans/2026-09-04-netlify-schema-data-rehearsal.md
---

# 执行回执：建立数据库 Baseline 与数据迁移演练

## 当前阶段

- 阶段：testing
- 当前门禁：把 baseline 与合成快照部署到隔离 Preview，取得 PostgreSQL 实库对账证据。

## 输入事实

- SQLAlchemy metadata：43 表、524 列、112 索引、26 个唯一约束、0 个物理 ForeignKey。
- 数据输入：仅固定全合成非生产记录。
- 流量边界：`/api/*` 继续代理 Zeabur。

## Skill 适配说明

第三方 `coding-skill-python` 含未渲染的 `{{FRAMEWORK_DESC}}`，不作为可执行配置；本变更仅采用其
RED/GREEN 小步原则，实际规范以 `AGENTS.md`、项目流程、当前代码与测试为准。

## RED / GREEN 证据

- RED 1：聚焦测试因 `app.netlify_schema_baseline` 不存在而收集失败。
- GREEN 1：实现 PostgreSQL DDL 生成器并生成 baseline 后，结构一致性测试通过。
- RED 2：聚焦测试因合成 seed/manifest 函数不存在而收集失败。
- GREEN 2：加入固定合成数据 seed 与无敏感正文的期望清单后，2 项聚焦测试通过。
