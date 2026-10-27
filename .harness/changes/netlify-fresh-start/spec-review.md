# Netlify fresh-start：独立 Spec 轴审查

日期：2026-10-27。范围为 Issue 07h 的本地初始化与平台接线，不是生产放行。

## 结论

- 已证实的实现阻断：0。
- 本结论已包含后续初始化 ready 门禁修复复核；初审未识别到的“runtime 开启但无初始化标记仍可触达旧 API/调度”缺口已由主线程提出并修复，不能将初审 0 问题视作该旧行为正确。
- **验证门禁尚未完成**：真实 PostgreSQL 的初始化、回滚、并发及宿主组合仍须由临时 PG CI 提供本轮成功证据；本报告不把源码符合规格等同于 Issue 验收完成。
- 未修改实现、生产配置或数据库，未联网调用外部服务或模型；本报告是本审查唯一文件变更。

## 依据与范围

按项目 AGENTS、CONTEXT、PROJECT_WORKFLOW、project-overview 当前范围和 CURRENT_IMPLEMENTATION 当前段审查；采用 expert-reviewer-front 的 Spec 轴及项目 `.harness/rules/`，不套用供应商 Vue 默认要求。

完整对照 `docs/superpowers/specs/2026-10-27-netlify-fresh-start-design.md` 与 `.scratch/netlify-native-migration/issues/07h-fresh-start-local.md`，并读取 PRD 最新范围覆盖段。

审查文件：bootstrap.ts、platform-host.ts、platform-netlify.ts、bootstrap migration、三个 runtime .mts 入口、runtime-bootstrap/native-platform-host/runtime-entry 测试、verify-runtime-local.mjs、http.ts/http.test.ts、vite.config.ts；并追踪 api-host/deployment/runtime/netlify/test-db 接缝及保留的 netlify.toml 代理。

## 规格匹配

1. **一次性管理员，不接管目标**：`bootstrap.ts:25-35` 在事务 advisory lock 后读取完成标记；无标记才锁组织、用户、空间表并拒绝任一非空表。配置回调在该检查之后调用；有标记时不读取初始密码、不执行 UPDATE、不重置账号。`bootstrap.ts:71-76` 审计与完成标记位于同一事务，失败回滚；release/连接错误经固定消息脱敏。没有 Reviewer 或专家资格自动授予。
2. **只由服务器配置初始化**：bootstrap 无 HTTP 参数入口，密码通过现有 Argon2 哈希；12–1024 字符及非纯空白检查匹配 Issue。迁移只创建单例状态表，不含真实邮箱、密码或历史 seed。
3. **候选入口与旧生产分离**：`runtime.mts:7` 仅注册 `/native-api/*`；`netlify.toml:13-14` 原 `/api/*` Zeabur 代理仍在。不存在本切片提前切流或关闭旧服务的实现。
4. **明确启用且默认关闭**：`platform-host.ts:42-48,57-58,68-69` 在精确 runtime gate 后才访问配置/池；fresh-start 只有 enabled 开启。缺省运行绑定为空；初始密码配置延迟至真正初始化。入口测试明确区分 SDK NODE_ENV 元数据和业务/Secret 读取。
5. **保留原鉴权边界**：normalizeNativeRequest 只重写同一 URL 的前缀，保留 Origin、请求体、Cookie 与 CSRF；API 复用已有完整路由。`platform-host.ts:52` 只传 Context.ip；测试核对伪造 X-Forwarded-For 不参与限流摘要。未认证、错误 Origin、缺少 CSRF 的路径分别有纯测试或待执行 PG 组合测试。
6. **消费/调度不制造完成感**：AWL 使用 SDK wrapper，池和发送器均延迟到认证后的事件处理；发送载荷只有 Operation ID。scheduled 复用有界 tick。PG 组合测试明确要求 202 后 Operation 仍 queued、没有 effect/Run，而非把发送确认当作任务完成。
7. **前端模式配对**：`http.ts:37-46` 只允许 `/native-api` 与 runtime 配对；非法 base 在 fetch 前失败，保留默认 `/api`。仅已有相对 `/api/` 字符串重写，未扩展外部地址配置。CSRF/body/credentials 与 session-expired 处理有定向测试。
8. **测试入口收敛**：verify-runtime-local 已纳入新增两个程序；Vite 排除 node:test 宿主测试，bootstrap 继续由现有 runtime 通配排除。无需新增依赖。

## 新验证证据及限制

独立执行：

```text
node --experimental-transform-types --test --test-name-pattern="^(?!PG |fresh database).*" scripts/runtime-bootstrap.test.mjs scripts/native-platform-host.test.mjs scripts/runtime-entry.test.mjs
```

实际结果：21 项被执行，15 项非 PG 通过，6 项 PG 在连接 `127.0.0.1:55432` 时 ECONNREFUSED，命令退出码 1。该环境下上述过滤没有排除 PG，因此不能将本命令报告为全绿。PG 失败发生在建立测试库前，不是已发现业务断言失败，也没有成功执行 PG 验收。

主线程提供的 RED→GREEN、HTTP/类型/lint/build 等证据须由主线程最终回执确认；本轴未独立重跑它们，不虚构覆盖率或全量测试通过。

## 对抗检查与交接条件

- 本地静态/替身测试不能证明数据库锁竞争、事务回滚或真实管理员登录，必须等待上述 PG CI 证据。
- 代码 gate、SDK 拒绝伪造请求不等于云端 AWL 已认证投递成功；schedule 注册不等于真实定时恢复已验收。
- 管理员密码和 qwen3.8-flash 的真实绑定是后续安全配置与新业务验收事项；本地切片不预置真实密码、不调用模型是符合当前范围的。
- 仍须区分本地代码、精确 SHA CI、云部署、用户登录/真实模型闭环、观察及 Zeabur 停用后复验。0 已证实实现阻断只允许进入下一验证步骤，不允许声明全新系统已完成。

## 增量复核：初始化 ready 门禁

主线程指出 P1 缺口后，本轴重新读取 platform-host.ts 全文及新增/调整测试：

- API 在 ensureFreshIdentity 后通过 requireInitializedPool 确认单例完成标记；fresh-start 未开启且无标记时返回固定 503，不进入身份限流、Session 或业务查询。
- AWL 与 scheduled 使用 createInitializedRuntimePool；第一次 connect 先查标记，未完成则不借出业务连接，释放检查连接并脱敏。AWL 仍在 SDK 认证前不读取数据库，不因 ready 门禁提前初始化。
- Promise 仅在当前调用创建的池包装器内缓存；失败不会永久阻断后续请求在初始化完成后恢复。
- 新 PG 组合断言覆盖未初始化时 API/tick 503、身份/Session/限流/Operation/effect/outbox 无写入，以及随后开启初始化后的正常路径；本轴仍未执行该 PG 用例。

独立增量验证：`node --experimental-transform-types --test --test-skip-pattern="fresh database" scripts/native-platform-host.test.mjs`，11 项通过、0 失败、退出码 0。此次 skip-pattern 成功排除 PG 组合测试，未连接生产或调用模型。

增量复核未发现剩余 Spec 阻断；真实 PG CI 和后续生产验收门禁保持未完成，不改写以上限制。

复核更新后的设计第 30–31 行有一处需精确化的表述：不能把 API/tick/SDK consumer 统一承诺为缺标记 HTTP 503。当前安装的 AWL SDK 在 index.js:845 捕获业务回调异常并交失败/重试处理，background 分支不保证对外返回 503；其他流式分支还能先给 ack。API/tick 固定 503 与 consumer 业务访问被阻断是已检查的边界，consumer 的外部接收状态不是业务成功。已通知主线程将规格分开描述；不要求改为绕过 SDK 的自定义认证或响应机制。

## 最后增量：兼容健康接缝

已确认设计已修正 consumer 失败表述，并新增已有 GET /api/health 的候选兼容接缝；上述文档建议已闭合。

复核 native/router.ts:52–60：仅精确 GET /api/health 查询数据库 SELECT 1 后返回 `{status:'ok',backend:'netlify-native'}`；连接在 finally 释放，异常传到现有 host 固定 503。公开候选路径仍是 /native-api/health，经 prefix 归一化后处理，platform 初始化完成标记检查先于 router 构造，故健康分支未绕过 ready 门禁。netlify.toml 旧代理不受此变更影响。

这是现有健康契约与候选部署边界的必要补齐，没有新增业务能力或提前切流。200 只证明本次已初始化标记和数据库查询可用，不证明模型、AWL、任务结果或用户验收完成。

独立有界验证：`node --experimental-transform-types --test --test-name-pattern="native health" scripts/native-platform-host.test.mjs`，1 项通过、0 失败、退出码 0，覆盖候选健康成功与数据库错误脱敏。本轴未执行全量、PG 或生产检查。当前剩余已证实 Spec 阻断 0，原 PG/云端验收限制不变。
