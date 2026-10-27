# Netlify 全新启用：Standards 独立审查

日期：2026-10-27。审查对象：当前未提交的 bootstrap、平台宿主、三个 runtime 入口、前向 migration、测试与验证入口，以及前端 API 路径接线。审查者未参与上述实现；未操作生产、安装依赖或调用模型。

## 结论

已证实严重问题：0。此结论仅允许继续 CI/隔离验证，不等于 PostgreSQL 事务验证通过、云端上线完成或可以停用 Zeabur。

## 规范与证据

- 已核对 AGENTS、CONTEXT、项目流程、当前项目范围、07h Issue、已确认设计及 Harness 工程结构、编码、运行时可靠性规则。以项目 React/TS 规范为准，不套用供应商 Vue 默认值。
- 架构沿用 native/api-host、runtime/netlify、现有身份与运行依赖工厂；平台适配器不重写领域状态机。没有新增依赖，也没有改动历史 migration DDL。
- 初始化默认关闭；配置为服务器惰性回调，不接受请求参数中的账号/密码。事务 advisory lock 串行化初始化，目标组织/用户/空间表锁阻止普通并发写入；非空目标拒绝，完成标记先于凭证读取检查。组织、用户、空间、成员、审计和标记位于同事务；已有标记不重设密码。该事务语义已代码审查，但真实 PostgreSQL 证据仍待 CI。
- 密码复用 Argon2 与 12–1024 字符约束并拒绝全空白；失败统一固定错误，包含连接、回滚与 release 路径，不把初始密码或邮箱写入审计正文。没有弱默认密码、开放注册或清库操作。
- 三入口精确匹配 ARC_NATIVE_MODE=runtime；独立冷模块测试只允许 SDK 的 NODE_ENV 元数据和应用模式读取。关闭时不访问业务配置、Secret、数据库或发送器；不是完全无平台订阅/无平台调用。
- 候选 Function 仅声明 /native-api/*，旧 /api 代理未改。归一化保留 method、query、headers、正文和 Origin；请求地址来自 Context.ip，伪造 forwarded header 未成为限流身份。前端只允许显式同源候选路径且要求 runtime 模式，保留 Cookie/CSRF 和会话过期语义。
- AWL 复用安装版本 SDK 的认证包装；无有效认证请求在数据库/发送器创建前拒绝。SDK 源码确认 callback 异常进入持久失败/重试路径；应用 runtime pool 对连接/query 异常固定化，发送只携带 Operation ID，发送失败不确认 Outbox。
- 每分钟调度只调用现有有界 tick，不在调度入口同步执行模型。闭合门禁不取消 schedule/event 注册；后台 Function 云端 HTTP 202 由平台提前返回且忽略函数体 Response，不能把本地 handler 的 404 当作云端 HTTP 404。
- 新增测试包含真正的响应、依赖访问、SQL 参数及失败确认断言，而非只检查函数存在。PG 测试使用固定 loopback 与独立随机 schema，扫描前向 migration、排除 seed、清理并验证 schema 不存在；真实锁阻塞/回滚/登录组合测试未因本地环境不可用而替换为通过的 mock。

## 本轮独立验证

使用仓库已有 Node，`--experimental-transform-types --test`：

- `scripts/runtime-entry.test.mjs`：1 项通过，独立进程验证冷模块读取边界。
- `scripts/native-platform-host.test.mjs`：按明确名称选择 9 项纯测试，9 项通过；未选择真实 PG 组合测试。
- `scripts/runtime-bootstrap.test.mjs`：按明确名称选择 5 项纯测试，5 项通过；未选择真实 PG 测试。

首次使用 `--experimental-strip-types` 因既有 TypeScript parameter property 不受 strip-only 支持而失败；随后按仓库 verify-runtime-local 的 transform-types 参数纠正并通过。这是审查命令错误，不是产品 RED，也不掩盖任何 PG 失败。

## 验证边界

真实 PostgreSQL 事务/锁/登录组合、完整 lint/build/部署检查由主线程与 CI 汇总；本审查不复用历史数字宣称本轮已过。SDK 成功认证后的云 Blob 状态、事件构建产物、定时触发、管理员真实配置、真实新业务闭环仍需后续验收。用户验收和稳定观察完成前保留 Zeabur，不能据此报告全新启用目标完成。

## 同日增量复审：初始化就绪门禁

主线程指出 runtime 模式与身份初始化完成应为两道门禁。已独立复核 `platform-host.ts` 与对应测试增量：API 在可选初始化后查询固定单例完成标记，再将 pool 交给业务路由；消费者/调度首次连接通过同一 readiness 检查后才借出业务连接。缺少标记时 API/tick 固定 503、消费者固定存储错误，不访问身份限流、会话或业务数据、不创建发送器。消费者检查仍惰性，未认证事件不触库。检查连接在 finally 释放，失败 promise 仅在单次 handler 构建的 pool 实例内缓存，下一次调用可恢复。

独立重跑平台宿主 11 项纯测试（10 项一组，另明确选择 `runtime mode without` 1 项）及独立冷入口 1 项，均通过。新增 PG 用例检查未初始化时 7 张身份/运行表不写入，再开启初始化继续登录闭环；该 PG 用例仍未在本地成功运行，不计入通过数字。增量未发现剩余已证实严重项；此前 0 项结论不能替代这一补充门禁，本节作为当前复审结论。

## 同日最终小增量：原生健康接口

独立核对 `native/router.ts` 的 GET `/api/health` 接线及对应宿主测试：公开候选请求仍经过 mode 和初始化标记门禁，随后执行 `SELECT 1`，仅返回固定 `status=ok/backend=netlify-native`，带 no-store/nosniff/DENY。查询连接由 finally 释放；连接/查询/释放异常向外传播至既有固定 503 边界，不回显数据库错误。未增加秘密读取、发送器或外呼路径。独立有界运行 `--test-name-pattern='native health'`：1 项通过。此健康响应仅证明已初始化库可查询，不替代新业务验收；PG/云端证据仍未补齐。最终已证实严重项 0。
