# 独立HTTP Tool测试调用202实施计划

状态：主线程已确认设计，07e ready-for-agent；本文件不授权真实外发、迁移或生产开关。
设计：`../specs/2026-09-06-http-tool-test-operation-design.md`。

## 最小文件清单（计划，不表示文件已新增）

1. `.scratch/netlify-native-migration/issues/07e-http-tool-test-operation.md`及本设计/计划/回执：确定AC和边界。
2. `netlify/database/migrations/<新的未使用时间戳>_runtime-tool-test-snapshots/migration.sql`：一张不可变快照表；
   选实际创建时未占用时间戳，不修改已执行migration。对账脚本表集同步纳入。
3. `reference-assets/routes.ts`、`handler.ts`、`postgres.ts`及新增`tool-test-postgres.ts`：受理接口、
   existing ledger去重、快照/Invocation/accepted审计同事务；无外部调用。
4. `runtime/types.ts`、`worker.ts`：effect可选beforeIntent事务守卫，既有调用默认行为不变。
5. 新增`runtime/tool-test.ts`及`runtime/http-tool-transport.ts`，调整`runtime/agent-tools.ts`只复用transport：
   Tool测试执行器与参数协议、固定意图、结果投影、Agent仍{input}不变。
6. `runtime/service.ts`、`runtime/postgres.ts`、必要时`controls.ts`：只新增tool.test dispatch/transition分支，
   generic Operation权限按kind补agent.write、jobs别名阻断；人工核对仍workspace.manage。
7. `reference-assets/history-postgres.ts`：严格范围内接受原生非终态、返回operationId关联与安全投影；
   不取消历史内容隐藏，不改变其他资产审计合法outcome。
8. `native/runtime-dependencies.ts`/宿主配置：将Tool所需非Secret Workspace+host绑定独立装配，不能借用
   模型Secret绑定隐式放开任意Toolhost。当前纯工厂返回toolOptions undefined，必须显式补端口与测试。
9. `src/api/assetLibrary.ts`、`src/types.ts`（ToolSkillInvocation）、`src/api/migrationCapabilities.ts`、
   `src/pages/AssetLibrary.tsx`、`src/components/OperationCenter.tsx`/`OperationProgress.tsx`：202状态、查询关联、
   kind-aware按钮权限，类型位置已只读确认。
10. 新增`scripts/runtime-tool-test-operation.test.mjs`、transport单测及相关原有脚本/前端测试；加入
    `scripts/verify-runtime-local.mjs`，遵循vite.config.ts前端/Node测试边界回归，不因排除前端而漏独立门禁；
    更新真实测试编排、
    `.harness`回执与当前实现事实，不把本地通过写成云端迁移完成。

## TDD顺序

1. 首个红测：已登录builder POST得到旧404，期望202及原子Operation/Invocation；实现最小受理无worker。
2. 同键去重/异载荷409/审计失败回滚/两个Session竞争/资产变动后同键仍原快照；通过后再worker。
3. 受控POST/GET参数合约、MCP固定失败（若选择）、禁Host与停用、queued→完整终态；不引入真实fetch。
4. 发送意图与deactivate交错：两个Session真实DB锁屏障；缓存结果不重复授权/发送，新的retry重新校验active。
5. 重复AWL/中断/未知结果、lease代次、cancel/requeue/reconcile、同步Invocation；无虚构Run。
6. generic routes对operator控制403、builder允许、reconcile管理员；jobs别名不绕过。
7. 历史页面pending/uncertain不409；前端202不显示完成，刷新恢复，Workspace切换不写旧结果，按钮权限按kind。
8. 先相关PG/transport/组件测试，再现有Agent Tool/runtime regressions、lint/typecheck/build与真实本地浏览器。
   精确云端部署/真实Tool允许目标与外发由主线程生产门禁负责，不在本地脚本用默认环境值自动开启。

## 交付条件

AC逐项有新证据、独立Spec/Standards审查严重问题0；具体新增kind/表/参数协议/UI契约共同审查。
仅HTTP成功不足以交付：去重、未知结果、权限及历史投影有任一漏项都不能进入ready-for-human。
不在此切片实现Run删除、MCP执行、任意headers/Secret、真实渠道或生产切流。
