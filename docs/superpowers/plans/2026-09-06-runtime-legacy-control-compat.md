# 原生旧执行控制兼容实施计划

1. `scripts/runtime-legacy-control.test.mjs`：用现有隔离 PG 与真实 HTTP backend 建立旧领取路由红测，
   验证未登录、CSRF、Workspace、权限以及授权 410 和审计。
2. `runtime/handler.ts` 增加精确 POST execution-jobs/next 路由；`runtime/postgres.ts` 在共享授权之后
   拒绝旧同步领取，记录 denied 审计并以 commitOnError 保存。
3. 主线程确认过渡契约后，`runtime/run-delete.ts` 只确认当前 Workspace Run 并形成拒绝诊断；
   `handler.ts` 接入 DELETE，`postgres.ts` 共享鉴权后记录 denied 审计并返回 409。无 DELETE/UPDATE 业务记录。
   测试涵盖缺失、跨域、未授权及终态/未终态/待核对数据保留。
4. 定向 HTTP/PG 回归、原 runtime-http 回归、typecheck/lint/build/diffcheck；记录可确认范围，不提交发布。
