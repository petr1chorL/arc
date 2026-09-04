---
id: H-20260904-02
status: done
feature: .scratch/netlify-native-migration/
prd: .scratch/netlify-native-migration/PRD.md
issue: .scratch/netlify-native-migration/issues/02-schema-and-data-rehearsal.md
design: docs/superpowers/specs/2026-09-04-netlify-schema-data-rehearsal-design.md
plan: docs/superpowers/plans/2026-09-04-netlify-schema-data-rehearsal.md
---

# 执行回执：建立数据库 Baseline 与数据迁移演练

## 当前阶段

- 阶段：done
- 当前门禁：已通过；永久 baseline 已进入 Production，合成数据与 Preview 探针未进入 Production。

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
- RED 3：Preview handler 测试因共享实现不存在而失败。
- GREEN 3：加入仅允许 `deploy-preview` 上下文的 handler 后聚焦测试通过。
- RED 4：真实 Preview 首次返回的工作流状态含替换字符；增加编码断言后聚焦测试失败。
- GREEN 4：生成器改用 `completed`，并通过新的前向 migration 修正已应用 Preview 数据；最终实库对账通过。

## 交付证据

- Preview：PR #37，Deploy `6a9a510c3cbfc200082c0288`，43 表、6 条合成记录及全部对账维度通过。
- Production：Deploy `6a9a53c1b2196e00085ab758`，commit `2207b35c9a999946080a245586ed9b49eaad89a8`，`Published / Migrations applied`。
- 隔离：PR #37 未合并并已关闭，远程临时分支已删除；Production 不含 seed、Preview Function 或纠错 migration。
- 质量：后端 407 项、前端 52 个文件 297 项、lint、Netlify typecheck、build 与 diff check 通过。
