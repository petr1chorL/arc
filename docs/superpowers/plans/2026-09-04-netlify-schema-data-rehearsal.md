# Netlify Schema Baseline 与数据演练实施计划

## 1. 固定结构契约

- 新增 `apps/api/tests/test_netlify_schema_baseline.py`，先要求 43 表清单、结构统计和 migration
  与生成结果一致，确认因生成模块/migration 尚不存在而 RED。
- 新增 `apps/api/app/netlify_schema_baseline.py`，只负责从 `Base.metadata` 生成确定性 PostgreSQL DDL
  与无敏感值的结构清单。
- 生成 `netlify/database/migrations/20260904060000_create-arc-one-baseline/migration.sql`，聚焦测试转绿。

## 2. 固定合成快照与对账契约

- 在测试中定义固定合成记录与期望摘要，先要求 seed SQL、表/行/主键、逻辑引用、状态和汇总结果。
- 最小实现生成 Preview 专用 seed migration；只允许固定虚构数据并支持重复执行不重复写入。
- 测试确认输出不含连接串、密码值、Token、Secret 或真实业务正文。

## 3. 创建实际 Deploy Preview

- 创建 `codex/netlify-schema-data-rehearsal` 临时分支。
- 提交 baseline 与 Preview-only 演练层，创建临时 PR。
- 等待 Netlify Deploy Preview ready；精确记录 PR、commit 和 deploy ID。

## 4. 对账与隔离验证

- 调用 Preview-only 状态 Function，核对 43 表存在、选定行数、主键摘要、逻辑引用、状态分布和
  Workflow Run 数值汇总。
- 确认 Production 不含合成数据，Zeabur `/api/health` 保持 200。
- 关闭 PR，删除 Preview deploy 和临时分支，再次检查 Production 与 Zeabur。

## 5. 提升 baseline 与收尾

- 仅提升 baseline 生成器、migration、测试、设计、计划和验证证据，不提升合成 seed/Function。
- 运行 Python 聚焦/全量测试、前端全量测试、lint、build、deploy:check 和 diff check。
- 推送生产分支，等待精确 Netlify deploy ready；确认 43 张空业务表可用且 `/api/*` 未切换。
- 更新 Issue、状态、当前项目事实和 Harness 回执，下一项指向身份与 Workspace 切片。
