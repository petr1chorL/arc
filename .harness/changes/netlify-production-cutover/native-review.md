# 原生全域 API composition 独立审查

日期：2026-09-06。审查者不是本切片实现者。
范围：`native/router.ts`、`native/deployment.ts`、`scripts/native-deployment.test.mjs`；
并追踪既有 resolver、handler、事务 backend 的鉴权接线。未修改实现或提交。

## 结论

本次限定的纯装配接缝 **未发现阻断问题**，可以进入主线程合并及 CI。
这不是生产切流放行，也不是全 API 兼容、真实权限矩阵、AWL、schedule 或云端验证结论。

采用 expert-reviewer-front 的 Spec/Standards 分轴检查；Vue 专属检查项不适用。
本报告由同一独立审查者分别记录两轴，不冒充两位审查者的并行独立结论。

## Spec 轴：需求与边界

- 身份和九个业务域均组合已有 resolver + handler + PostgreSQL backend，没有替代 Session、
  Workspace、RBAC、CSRF、审计或持久化行为。Runtime 优先的明确路径未覆盖资产生命周期路径。
- 默认关闭只接受严格等于 `runtime` 的服务端模式；缺失、大小写差异、空白和其他模式均 404/no-store，
  且不会调用 loadPool。
- 原生 router 不含测试控制路由、种子、测试身份、自动消费或模型/通知传输实现。
- 测试确认 `/__tick`、`/__ready`、`/__shutdown` 和未知 API 不连接数据库；畸形路径受控失败。
- 五个旧端点兼容缺口、生产绑定及 consumer/tick 未实现，回执准确保留边界，没有将组合完成写成迁移完成。

严重问题：0。

## Standards 轴：权限、隔离与可维护性

- handler options 按请求传入，未缓存首个访问者的 clientAddress；不从 X-Forwarded-For、
  X-Arc-Test-Client 或 Cookie 推导可信 IP。
- 所有域复用既有 HandlerOptions；跨 Origin 写请求在业务数据库连接前被拒绝。
- SqlPool 通过显式加载端口注入；无平台全局环境读取、外部 fetch、动态包下载或凭证读取。
- 数据库初始化异常统一返回 503/no-store，未回显内部异常，后续请求仍可重试初始化。
- 新模块只单向依赖已有域模块，没有反向依赖测试服务器或页面；未新增依赖、生产路由或配置变更。

严重问题：0。

## 测试质量与新证据

独立执行 `node --experimental-transform-types scripts/native-deployment.test.mjs`：
**6 passed / 0 failed（30.83 ms）**。

覆盖精确关闭门禁、十域无 Session 的 401、未知/合成/畸形路径、十域代表写路径的跨 Origin 拒绝、
两个不同可信 IP 的限流 bucket 及伪造转发头不生效、初始化失败脱敏与可恢复。
首次带 `--test` 的沙箱命令因子进程 spawn EPERM 失败；改用实现者已有的直接 Node 测试命令成功，
不是实现失败或绕过任何业务校验。此次验证不使用真实数据库和平台资源。

## 非阻断建议与后续必须保持的边界

1. 当前是每域代表路由测试；未来新增 resolver 时宜增加路由全量唯一性断言，避免 first-match 顺序
   隐藏新路径碰撞。本轮阅读没有发现现有覆盖冲突，不能把代表路由测试称作全量契约验证。
2. 真正公开 Function 接线时必须从平台可信 context 获取 IP，并继续使用 gated deployment 接缝；
   本模块本身不证明未来宿主一定传入正确的 IP 或模式。
3. `createPostgresRuntimeClosureBackend` 的 costConfigured 仍沿用默认值，本切片没有提供模型/计价
   配置装配；未来 runtime dependencies 实现时需要明确传递并验证，不能将当前接缝描述成真实成本配置。

未评价、未放行：AWL、schedule、真实模型/通知外发、云端部署、数据备份恢复、任务转换、切流回滚、
稳定观察及关闭 Zeabur。
