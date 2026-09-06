# Node / Vitest 测试入口边界独立审查

2026-09-06。范围：vite.config.ts 的四个精确排除、新 test-runner-boundary 回归、
verify-runtime-local 的17程序清单及CI调用；对照同日 test-runner-boundary 设计/计划。
本审查不改实现、不提交、不启动数据库或生产操作。

## 结论

**未发现阻断问题，没有发现因本次排除而漏跑的测试。** 四个Node程序从不适用的jsdom运行器移除，
仍由独立17程序验证入口执行；该入口仍是CI的必经步骤，失败会使进程非零退出。
可以进入主线程最终验证/提交，尚不能宣称修复提交的云端CI已成功。

## Spec 轴：需求匹配与覆盖

- 精确排除 native-deployment、native-runtime-config、provider-compat、cutover-source-inventory，
  不扩大为整个scripts目录；原 runtime-*.test.mjs 排除保持。
- 四文件逐一存在于 `checks` 的可执行数组，不是只在注释中提及；所有目标通过process.execPath逐个运行，
  spawn错误或非零exitCode立即使验证失败。当前17个程序未被删除、跳过或改断言。
- `.github/workflows/ci.yml` 仍调用 `node scripts/verify-runtime-local.mjs` 并传合成PG端口5432；
  没有continue-on-error或条件跳过本步骤。
- 新边界回归同时检查现有node:test import文件的排除与独立验证注册，还断言它自身仍归Vitest。

## Standards 轴：最小变更与验证分工

- 修改的是运行器归属，未修改源库SQL URL以掩盖jsdom误收集，也没有改业务/凭证/数据库连接逻辑。
- Node程序使用Node的文件URL与真实隔离PG，Vitest/jsdom继续负责前端及适用脚本测试，分工与现状一致。
- 新回归使用现有Node/Vitest工具，无新包或生产调用。源码清单扫描符合当前静态import/顶层scripts布局。
- 此检查不是通用JavaScript解析器：以后若引入嵌套目录、动态node:test import或动态构造验证清单，
  应同步更新边界测试；当前读取实际文件和清单没有发现这种遗漏。

## 独立新证据

1. `node node_modules/vitest/vitest.mjs run scripts/test-runner-boundary.test.mjs --maxWorkers=1 --no-file-parallelism`：
   **1 file / 1 test passed，686ms**。
2. `node node_modules/vitest/vitest.mjs list --filesOnly`：成功列出前端与适用脚本测试；上述四个Node程序
   均不在列表，test-runner-boundary、reference-assets、workflows及其他业务测试仍在实际收集列表。
3. 只读核对当前所有直接node:test导入程序均在独立验证器；其余非node:test的runtime验证程序也继续保留在17清单。

本轮不重复17程序/全量前端和build：Node测试源码没有此次修改，主线程正在执行完整前端与构建，
对应结果应由主线程回填，不能把这份独立定向证据当作全量或云端门禁成功。
