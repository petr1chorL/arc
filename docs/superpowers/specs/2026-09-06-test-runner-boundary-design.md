# Node / Vitest 测试入口边界修复

用户已授权继续完成迁移及必要修正。CI 34021720282 在前端 shard 3 收集
cutover-source-inventory.test.mjs 时失败：ERR_INVALID_URL_SCHEME；该文件是 node:test，
不是 jsdom/Vitest 测试。原配置只排除 runtime-*.test.mjs，新四个命名未被排除。

底层目标：每项测试由正确运行器执行，既不能误收集，也不能因排除而漏跑。
最小修正：vite.config.ts 明确排除四个已注册 Node 程序，保留原 runtime 模式；
新增 Vitest 回归扫描 scripts 中 node:test 文件，核对排除规则和独立门禁注册同时存在。
不改变业务、Node 程序断言、数据库端口或 CI 的 17 程序步骤。

AC：新回归在修正前失败；修正后通过，受影响前端完整收集/执行通过；
所有被排除的 Node 测试仍由 verify-runtime-local.mjs 执行；lint/build 和云端门禁通过。
对抗检查：不能改 SQL URL 来掩盖运行器错误，不能删除测试或扩大到 scripts 全目录排除。
