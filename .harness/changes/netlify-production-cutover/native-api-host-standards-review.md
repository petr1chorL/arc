# 内部原生API宿主 Standards 独立审查

日期：2026-09-06。依据native-api-host.md，仅Standards轴；Spec轴由另一审查者独立完成。
已读api-host.ts、router.ts、deployment.ts、native-api-host.test.mjs及相关Provider/closure接缝。
未编辑实现、测试、运行配置或公开Function；只新增本报告。

## 结论

当前内部接线范围未发现严重规范/权限问题，可交主线程整合门禁。
真实业务后端已收到Provider存在性与costConfigured两个options，这不等于生产公开入口、AWL或tick已启用。
与前份纯工厂审查不同，本报告确认的是内部宿主接线实际可用；不再把这两个options误记为完全无消费者。

## 默认关闭与依赖顺序

- createNativeApiHost构造阶段仅创建闭包；loadPool/loadConfig/resolveSecret/fetch属性不会被提前解引用。
- deployment每次先检查mode精确runtime；其他值404/no-store，不调用backend loader或pool loader。
  测试用四个会抛错的依赖getter验证关闭分支，覆盖缺失/off/大小写/多余空白。
- 开启时先loadBackendOptions→createNativeRuntimeDependencies解析配置，再loadPool，再构造既有域后端。
  配置失败由deployment try/catch变固定503，不初始化数据库pool；下一请求重新读取，不缓存故障。
- 配置解析可以早于登录，因为它不读取Secret值；实际secretPresence仅在Provider后端完成
  workspaceContext、CSRF、agent.write、Provider归属及历史配置检查之后运行。

## Options、鉴权与可见结果

- NativeApiBackendOptions的两个可选字段由真实工厂的Parameters类型派生，不复制漂移的手写结构。
- router将providerOptions只交reference-assets backend，closureOptions只交runtime-closure backend，
  其他域保持原有构造。旧调用未提供第三参数时默认安全缺配置状态不变。
- 没有替换Session/RBAC/CSRF中间层，也没有在路由前直接测试Secret；合成PG验证未登录401、缺CSRF403、
  viewer403时解析计数为0。builder只有精确Workspace/Host/SecretRef匹配才触发一次合成解析。
- costConfigured真实经observability/cost-usage查询：缺费率false、显式双零和正费率true；
  仅说明配置存在，不代表生产账单已核实。API宿主没有调用gateway.complete或执行模型。

## 错误与请求隔离

- 配置和pool初始化位于已有脱敏503/no-store边界，错误正文不回显loader异常；业务错误保留共享HTTP响应。
- options由每次handler调用直接传到新router，各域createApiHandler复制本次allowedOrigins；
  clientAddress不会缓存在首个请求的闭包中。
- 实际PG限流bucket存在两个宿主指定IP的摘要，不存在客户端X-Forwarded-For伪造IP摘要；
  此内部API不会从客户端header选择真实IP。公开平台context.ip接线依旧必须在宿主层单独实现和验证。
- 没有新增全局可变缓存或通过singleton存放用户、Session、IP、Workspace、成本选项。

## 平台与范围

- api-host仅import内部deployment与runtime依赖工厂；没有SDK初始化、env读取、后台调度或外发调用。
- 在netlify/functions内搜索createNativeApiHost只命中其内部定义，未发现公开Function引用启用。
- 本切片不修改netlify.toml、公开API/AWL/scheduled入口；也没有前端默认迁移模式切换。
  本次代码审查不替代生产站点状态探针，主线程应继续按精确SHA验收。

## 独立新验证

- `ARC_RUNTIME_TEST_PORT=55433 node --experimental-transform-types scripts/native-api-host.test.mjs`：
  3 passed / 0 failed，586.089ms。
- `node --experimental-transform-types scripts/native-deployment.test.mjs`：6 passed / 0 failed，36.507ms。
- 使用已提供的loopback合成PostgreSQL、随机schema；helper finally清理并核对schema不存在。
  没有读取生产Secret、调用实际模型、启动/停止容器或提交推送。
- 作者已记录lint/typecheck通过；最终整体build、测试编排和云端门禁由主线程汇总，不重复无新疑点的全量测试。
