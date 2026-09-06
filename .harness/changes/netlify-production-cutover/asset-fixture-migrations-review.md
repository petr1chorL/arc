# Reference Assets 夹具迁移独立复审

日期：2026-09-06。审查者：独立 Agent `ci_workflow_fix`。

结论：本次测试设施修复未发现阻断项；没有发现其他仍使用旧 schema、且实际读取新 Invocation 历史依赖的旧 CI 夹具遗漏。此结论不代表生产迁移、切流或 Zeabur 关闭验收完成。

## 范围与方法

- 对照 `docs/superpowers/specs/2026-09-06-reference-assets-fixture-migrations-design.md`，按 expert-reviewer-front 的需求匹配与反方检查口径复核三个脚本 diff、真实历史读取路径、其他调用方及清理路径；不替代另一审查轴的独立报告。
- 只审查 `scripts/runtime-test-db.mjs`、`scripts/test-reference-assets-postgres.mjs`、`scripts/reference-assets-e2e-server.mjs` 的设施改动；产品源码只读用于依赖追踪。
- 未运行全量测试，未连接生产或读取凭证，未启动/停止数据库，未修改实现。

## 根因及需求匹配

`reference-assets/history-postgres.ts:90` 对每个 Invocation 调用 `nativeToolAssociation`；该函数在 `:103`、`:105` 查询 `runtime_operations` 和 `runtime_tool_test_snapshots`，即使该行最终按旧 Invocation 返回也需要相关表存在。两个旧资产夹具仅执行 baseline/rate-limit，因此 schema 不再满足当前产品查询路径。修复初始化依赖而保留 HTTP 200 和历史内容断言符合设计，不应通过吞掉缺表或删断言修复。

`applyTestMigrations` 是对 `runtimeTestDatabase` 原有循环的原样提取：迁移目录定位、名称排序、名称含 `seed` 排除、无 `migration.sql` 跳过、UTF-8 读取以及顺序 `await client.query` 均保持不变。既有 runtime 夹具的连接参数、超时、生成 schema、清理和异常传播未改变。资产 PG 脚本及浏览器服务只增加共享 helper 调用；旧的状态码、历史、跨 Workspace 和角色权限断言无修改。

## 独立验证

以无数据库的记录型 query client 调用真实 helper，逐项对照排序后非 seed 文件的完整 SQL 内容：

- 8 个结构迁移，顺序及内容完全相同；包括 runtime closure、operations、agent tools、tool test snapshots。
- `20260904134000_preview-only-seed-identity-workspace` 未执行；未读取其正文。
- 首次 query 抛出标记异常后，helper 以同一异常拒绝，调用次数严格为 1，没有吞错或继续迁移。
- 以上检查通过，进程 exit 0。检查未创建文件、数据库或网络连接。

静态检查当前非 seed SQL 未发现 `SET search_path`、`CREATE SCHEMA` 或 `public.` 定位；唯一数据更新为 strengthen-platform-probe 对刚创建于隔离 schema 内的 probe 表补列。当前迁移内容不会绕过调用方设置的 schema。此判断不自动覆盖未来新增迁移。

## 隔离与清理

- 两资产调用方保持固定 loopback、`arc_identity_test`、数值端口校验及随机十六进制 schema；helper 使用调用方已有 pool，不读取连接环境或另外建立连接。
- PG 脚本在 `finally` 关闭 pool 并仅删除本轮生成 schema；浏览器服务的成功关停和启动失败均进入原有 `close` 路径，仍仅删除本轮 schema。
- helper 自身不承诺事务性迁移，也不负责创建/清理 schema；部分迁移失败的清理由原调用方承担。此次提取没有改变该既有边界。
- `seed` 名称过滤是既有测试策略，不是通用安全判定；本次实际 preview seed 名称匹配并被排除，没有把生产初始化/种子能力混入测试。

## 其他旧夹具排查

搜索 `scripts/` 和 `e2e/` 的真实 Reference Assets backend、历史模块及 Invocation 调用后：

- `runtime-e2e-server.mjs`、`runtime-tool-test-fixture.mjs`（供 lifecycle 等测试使用）、`provider-compat.test.mjs` 已使用完整 `runtimeTestDatabase`。
- `native-api-host.test.mjs` 的集成数据库也来自 `runtimeTestDatabase`。
- `test-rubrics-postgres.mjs:204` 虽使用旧 baseline/rate-limit 并构造资产 backend，但实际仅 POST 创建 Model Provider，用于后续 Rubric HTTP 合同；不读取 Invocation 历史，不需要为此次修复扩大 schema。
- `reference-assets.test.mjs` 仅覆盖路由和默认门禁，不是旧 PG 历史夹具。
- 未发现其余旧身份、Agent、Workflow、Data Object、Feedback 夹具实际调用新资产历史依赖；不把它们无差别改成全量迁移符合设计范围。

## 主线程验证证据与边界

以下由主线程完成并回报，非本审查者重复运行：修复前原 PG 测试在历史断言 503/200 确定 RED，专属数据库日志缺 `runtime_operations`；修复后使用既有 `apps/api/.venv/Scripts/python.exe` 完整通过 198 checks、52 roleRouteChecks、26 sharedRequestCases；共享 22 个原生验证程序、9 个资产/治理浏览器用例（24.5s）、lint、build、deploycheck、diffcheck 均通过。

中间默认 Python 和根 `.venv` 分别缺 `pydantic_settings`、`argon2` 是所选解释器依赖不足，不是此次 SQL 修复失败；未通过安装依赖掩盖问题。需要最终 CI 验证仍由主线程推进，本报告不提前宣称云端运行成功。
