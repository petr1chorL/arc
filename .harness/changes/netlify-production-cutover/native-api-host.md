# 原生内部 API 宿主接线设计与验收

日期：2026-09-06。状态：local-pass，两位独立审查者的 Spec/Standards 轴均通过；内部接线切片，不是公开部署。

## 第一性原理与实现前设计

底层目标：已经验证的配置应真实影响既有 Provider 配置检查和成本可观测响应，不能只返回没有消费者的 options。
必要约束：默认关闭、配置校验先于数据库初始化、Secret 存在性在业务权限检查之后、可信 IP 每请求独立。
选择最小内部工厂接线，不复制鉴权/业务服务，也不添加公开路由或平台环境读取。

计划及精确文件：

1. `scripts/native-api-host.test.mjs`：先 RED，关闭时 config/pool/secret/fetch getter 零读取；配置错误为脱敏 503 且再次可成功。
2. `native/router.ts`：第三参数 `NativeApiBackendOptions` 只包含既有 providerOptions/closureOptions，传入相应 backend；默认保持缺配置成本 false。
3. `native/deployment.ts`：增加可选 lazy loadBackendOptions，门禁通过后先调用它、再初始化 pool，失败沿用 503/no-store；每请求 HandlerOptions 不缓存。
4. `native/api-host.ts`：把现有 createNativeRuntimeDependencies 与 deployment 接线；不在工厂构造或关闭模式中读取延迟依赖，不调用实际运行或 SDK。
5. 使用主线程提供的新合成 PostgreSQL 随机 schema，真实 handler/backend 验证两 options 的可见结果，并确认无 Session/权限/CSRF/错误绑定时没有 Secret 解析。
6. 跑新测试、既有 6/5 原生测试、lint/typecheck；最终整体 build/独立审查由主线程汇总。生产 API/AWL/tick 和切流保持未完成。

## 对抗式验收标准

- [x] 默认关闭先于配置、数据库与 Secret/fetch getter。
- [x] 非法配置 503 不泄漏异常正文、不初始化 pool，后续请求可恢复。
- [x] Provider 配置检查真实经 Session/RBAC/CSRF 后触发精确绑定的存在性解析。
- [x] 成本缺配置为 false、显式双费率包括双零为 true，经过真实组合查询证实。
- [x] 不缓存首个请求 IP；既有原生6/5测试不回归；无公开入口或生产配置变化。

## 验证回执

- RED 1：目标内部宿主模块不存在，测试 ERR_MODULE_NOT_FOUND。最小门禁委托后关闭测试通过。
- RED 2：没有接入配置 loader，坏配置得到 401 而非预期 503；真实数据库成本查询显式双零配置仍返回 false。
- GREEN：router 第三参数传入两既有 backend；deployment 在 pool 之前读取可选 lazy backend options；
  api-host 将现有依赖工厂结果映射给这条接缝。
- `ARC_RUNTIME_TEST_PORT=55433` + `node --experimental-transform-types scripts/native-api-host.test.mjs`：3 passed，564 ms。
  使用主线程新建的 `arc-one-native-host-verify-20260906`，随机 schema 由现有 helper 创建，finally DROP 后再查询 schema 不存在。
  本 Agent 没有停止容器，交由主线程统一核对清理。
- 真实 PostgreSQL 验证包括：实际登录；成本默认 false、双零/正值费率 true；无 Session 401、缺 CSRF 403、
  viewer 403 且 Secret 调用零次；builder 错 Workspace 绑定 missing_secret 且不解析；正确绑定 ready 且仅一次合成解析。
  数据库 rate-limit bucket 同时记录两个不同宿主可信 IP，伪造 X-Forwarded-For IP 未出现。
- `node --experimental-transform-types scripts/native-deployment.test.mjs`：6 passed，30 ms；额外在原关闭测试中加入 backend loader getter 禁止读取。
- `node --experimental-transform-types scripts/native-runtime-config.test.mjs`：5 passed，25 ms。
- `npm run typecheck:netlify`、`npm run lint`、`git diff --check`：通过（Windows 换行提示不构成内容失败）。

主线程整合：18个Node程序全部通过；新Node测试已加入独立清单并精确排除Vitest收集。
防漏跑回归先因新文件未归属失败，补齐后1项通过；最终lint/build/deploy:check通过。
前端业务没有本切片修改，69文件681项证据来自此前运行器修正；不重复描述成当前再次全量执行。

## 对抗式审查与下一边界

- 未新增认证或权限替身；受控 PostgreSQL 使用真实 handler/backend，选项不会绕开已有能力校验。
- 保留非原生 deployment 调用的可选配置兼容：不提供 options 时 Provider 缺凭证、成本未配置，均不误报成功。
- 模式/config/pool 错误不会缓存为永久拒绝；下一次请求重新装配可恢复，异常正文被既有 503 边界脱敏。
- 每请求 HandlerOptions 直接向下传递，不在模块或首次请求缓存 clientAddress/allowedOrigins。
- 工厂只组合已有依赖；没有读取实际 env/Secret、执行真实模型/通知、修改 SDK/公开 Function、netlify.toml 或 CI。
- 这是内部接线可用证据；公开宿主的 context.ip/Netlify.env 配置、原生 health、AWL/tick 云端接线及真实迁移/切流仍未完成。
- 未提交代码；当前云端 CI 不包含本次未提交改动，不能将其结果作为本切片云端验证。
