# 05/06 本地实施计划

依据：同日 runtime-closure-design，用户已回复“同意”。不包含提交/部署/切流。

## 文件与顺序

1. `netlify/database/migrations/20260906160000_runtime-operations/migration.sql`、
   `netlify/functions/_shared/runtime/{types,ledger,worker}.ts` 和 `scripts/runtime-ledger.test.mjs`：
   先复现同键重放/领取竞争/不确定发送，再实现事务 Operation、领取代次、副作用账本和 AWL Outbox。
2. `netlify/functions/_shared/runtime/{handler,postgres,workflow,service,router}.ts` 和
   `scripts/runtime-{workflow,http}.test.mjs`：逐条贯通固定版本运行、状态查询、重试取消、节点输入/产出物与追踪。
   每条先写失败行为测试再实现；PG 随机 schema，不使用业务数据。
3. `netlify/functions/_shared/runtime-delivery/` 与 `scripts/runtime-delivery*.mjs`：
   独立实现通知/调度的契约、持久化和到期派发，覆盖重复、暂停、重叠与发送未确认。
4. `netlify/functions/_shared/runtime-closure/` 与 `scripts/runtime-closure*.mjs`：
   独立实现人审/评分/整改/产出物/观测，通过共享 Operation 接口集成，受控外部适配器验证。
5. `src/api/operations.ts`、`src/components/OperationProgress.tsx` 及相关测试：
   先验证 202 不显示成功完成、跨 Workspace 切换丢弃旧请求，再接入现有运行与评估页面。
6. `netlify/functions/runtime.mts`、`runtime-workload-background.mts`：
   默认休眠入口和可注入 AWL 接缝测试，无业务 schedule、无构建发送或生产路径变更。

独立服务可以并行，共享 Operation 接缝与最终集成由主 Agent 控制。
每个小循环运行对应 `node --experimental-transform-types --test --test-isolation=none scripts/runtime-*.test.mjs` 或已有本地 Vitest；
先记录因目标行为缺失失败，再记录通过。PG 检查使用 loopback 55432 并独立清理随机 schema。
收尾运行 `npm run lint`、`npm run build`、对应 PG 集成和浏览器闭环、相称的完整回归。
所有命令必须实际运行后才写入 verify；不把本计划当作证据。

## 集成与反方检查

拒绝将 PG 事务与 AWL/外部调用当作同一提交；确认取消后旧代次无权写回。
审查每个跨 Workspace 引用、秘密读取接缝、历史 Review 旁路及 Noop 通知投影。
仅工程验证通过可标 ready-for-human；真实模型质量和生产稳定性不由合成测试证明。
