# 原生全域 API 装配与默认关闭门禁回执

日期：2026-09-06。状态：local-pass，待主线程合并审查；不是生产切流验收。

## 范围与第一性原理

依据同日生产切流设计和实施计划第 2 项，以及主线程分派的可独立验收切片。
底层目标是让已实现的身份和九个业务域具备纯生产装配接缝，并确保未来公开入口没有明确切流配置时关闭。
必要对象是域 resolver、既有 handler/backend、显式 SqlPool、每个请求的可信 clientAddress/allowedOrigins。
这一步消除依赖本地合成测试服务器装配的障碍；不改变主写位置，也不创建任何生产绑定或 Secret。

新增文件：

- `netlify/functions/_shared/native/router.ts`：组合身份、资产、Agent、DataObject、Rubric、Feedback、Workflow、Runtime、Closure、Delivery。
- `netlify/functions/_shared/native/deployment.ts`：仅精确 `runtime` 模式开启，缺失/错误模式返回 404/no-store，不调用 loadPool。
- `scripts/native-deployment.test.mjs`：六项无需真实生产资源的接缝测试。

`createNativeApiRouter(pool, options)` 不读取平台 globals，不创建种子和外部 transport。
`createNativeApiDeployment({mode, loadPool})` 返回 `(request, options)`，每个请求单独传入宿主的可信 context.ip，
不从 X-Forwarded-For 等请求头推导可信地址，也不缓存第一个请求的身份配置。
`isNativeDeploymentEnabled` 可供后续 consumer/tick 复用，但本次没有改动这些入口。

## TDD 与新验证

- RED：生产文件不存在，直接运行聚焦测试得到 `ERR_MODULE_NOT_FOUND`。
- GREEN 1：默认关闭模式测试通过；所有非精确模式不初始化依赖。
- RED 2：启用后的身份请求返回 503，预期到达既有鉴权并返回 401。
- GREEN 2：接入域工厂后十个域代表路由都到达既有鉴权；修正测试替身以遵守现有请求预算返回结构。
- 最终 `node --experimental-transform-types scripts/native-deployment.test.mjs`：6 passed，0 failed（31 ms）。
- `npm run typecheck:netlify`：通过。
- `npm run lint`：通过。
- `git diff --check`：通过；现有 Windows 换行提醒不是行为失败。
- `npm run build`：沙箱内首次 Vite 子进程 `spawn EPERM`；经权限通道重跑通过，292 modules，现有大 bundle 提醒仍在。

六项验证分别覆盖默认关闭、十域鉴权接线、未知/合成控制/畸形路径、各域写入 Origin 拒绝、每请求可信 IP 和 allowedOrigins 传递、依赖初始化失败脱敏及可再次尝试。
测试没有访问 PostgreSQL、真实模型或生产平台；该结论是装配接缝验证，不是十域完整契约重验。

## 对抗式审查与未实现边界

- 所有业务请求继续走既有 handler 与事务 backend，没有直接调领域服务绕开 Session/RBAC/CSRF/审计。
- 关闭门禁时没有数据库初始化；异常响应不泄漏内部错误；未识别路径固定 404/no-store。
- 合成服务器 `/__tick`、`/__shutdown`、`/__ready` 未被引入，trusted IP 不接受测试控制头。
- 未修改公开 Function、`netlify.toml`、CI、前端模式、数据库或生产配置；没有提交/推送。
- 没有新增 health、实际 AWL/schedule 装配、生产 Gateway/SecretRef 解析、五条兼容端点或旧任务转换。
- 没有证明生产备份、恢复、切流、观察或 Zeabur 关闭；07/08 整体不能据此标完成。

检查过 coding-skill-front，但其未渲染占位符和 Vue 假设不适用于该 TypeScript 服务器装配；未执行模板命令，采用项目规则及既有真实验证命令。
