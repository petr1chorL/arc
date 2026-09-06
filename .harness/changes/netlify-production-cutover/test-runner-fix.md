# 测试运行器边界修复回执

2026-09-06。CI 34021720282 / 提交 4c65b48 前端 shard 3 失败：
cutover-source-inventory.test.mjs:6 的 file URL 在 jsdom/Vitest 中变成非 file scheme。
此程序使用 node:test，原本由独立 Node/PG 门禁执行；问题是 Vite 仅排除 runtime 命名前缀，
新增四个不同前缀的 Node 测试被误收集，不是 SQL 盘点结果或生产数据问题。

最小修正：vite.config.ts 精确排除 native-deployment、native-runtime-config、provider-compat、
cutover-source-inventory 四个 Node 文件。不改原测试、17程序注册表或 CI 执行步骤。
新增 Vitest 回归扫描 node:test imports，确保每个同时满足“前端不收集”和“独立门禁有注册”，
同时保证回归自身没有被排除。将来修改配置格式需同步维护该静态接线检查。

RED：新回归明确失败 cutover-source-inventory.test.mjs must not run in jsdom。
GREEN：配置修正后 1 passed，670ms。此前 sandbox EPERM 是启动权限限制，不计作 RED。
本轮 lint/build（含两类 TypeScript 检查）/deploy:check 均通过。
主线程全量 Vitest：69 文件、681 项通过，120.00s，exit 0。
独立审查未发现阻断或漏跑，定向1项通过且实际 list --filesOnly 确认分工，见 test-runner-review.md。
修复提交 `1940c36f5f2d8ddc90b8151bdfb8f92e9401f778` 的云端 CI `34022125444` 全部成功。
后续宿主提交 `2f51d8e085b9da9857b66286779848d151073916` 的 CI `34023212681` 也全部成功。
Netlify 当前发布仍为 b626602，不能把 CI 成功写成最新代码已发布。

对抗边界：没有扩大为 scripts 全目录排除，没有跳过测试、移除断言或改变数据库端口。
17 Node 程序的完整通过证据来自配置变更前同一实现；配置修正不改变其文件内容。
