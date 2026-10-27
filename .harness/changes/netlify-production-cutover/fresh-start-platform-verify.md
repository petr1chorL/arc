# 全新启用切片B：平台宿主接线回执

日期：2026-10-27。当前：本地实现，ready门禁修复后11项纯测试通过；真实PG组合测试待有效一次性数据库或CI验证。
PRD/Issue：`.scratch/netlify-native-migration/PRD.md`、`issues/07h-fresh-start-local.md`。
已确认设计/实施顺序：`docs/superpowers/specs/2026-10-27-netlify-fresh-start-design.md`。

## 目标与文件

底层目标是让既有原生领域实现由真实平台入口调用，同时把平台启用与业务成功明确分开。
实现 `native/platform-host.ts`（可注入宿主）和 `platform-netlify.ts`（薄平台适配），改三个 runtime `.mts` 入口。
不改领域状态机、bootstrap实现、生产TOML代理、CI runner、业务前端或主文档。

采用 Netlify Functions/Database 技能并调用 creationType=`netlify-functions` 官方coding context。
读取现有SDK0.0.106真实源码后复用`createRuntimeWorkload`、`AsyncWorkloadsClient`；没有安装/升级依赖。
供应商 coding-skill-front 的Vue/模板占位符不作为执行配置，以项目TS/Harness规则为准。

## 接线事实

- 三入口仅 `ARC_NATIVE_MODE === 'runtime'` 启用。其他值只读取mode，不读取运行配置、初始密码、DB getter或sender getter。
- API复用createNativeApiHost；配置来自ARC_NATIVE_RUNTIME_CONFIG，缺失时空bindings；成本配置和Provider绑定沿既有工厂。
- `/native-api/`仅起始前缀归一化为`/api/`，保留同一origin、method、headers、Cookie/CSRF、query和body流；不改任意中间段。
- 每请求使用context.ip；客户端X-Forwarded-For不作为限流来源。未增加CORS或放宽Origin。
- API loadPool后调用ensureFreshIdentity：enabled仅精确ARC_FRESH_START=enabled；email/password仅由初始化器按需调用loadConfig读取。已有marker不再读取密码；失败为固定503且下一请求可恢复。
- 全新就绪门禁：API初始化器返回后，还必须查询native_bootstrap_state的arc-one标记才能把pool交给业务路由；fresh disabled且没有marker时固定503，不接受未知目标旧用户。worker/tick首次借连接同样先检查marker，缺失不查业务表、不建Operation/effect、不发送事件。检查不读取初始密码，检查连接始终finally释放；就绪promise只存在本次消费/tick内，不跨请求缓存。
- workload在应用mode门禁后进入真实SDK认证。pool和sender延迟到SDK认证后的业务回调，未认证请求不会初始化DB或发事件。SDK0.0.106携带旧Context flags类型，实际wrapper不使用context参数；仅在该调用边界显式转换，未伪造平台字段。
- runtime pool连接/query异常固定化，避免SDK日志收到原始数据库错误；API仍用原pool保留领域重复约束映射。SDK客户端自身平台通信日志不被宣称由本应用全量接管。
- sender固定eventName=`arc-one:runtime`，data只有operationId；sendStatus失败或抛错都不确认Outbox。发送端不接受浏览器输入或任意URL。
- schedule每UTC分钟（本地亦每分钟）调用既有tickRuntime，保留每批20等现有边界与派发时间预算；只建意图/唤醒，不同步执行模型。未新增完整调度容量/SLO保证。

## RED → GREEN 与验证

- 首RED为宿主模块缺失；最小关闭门禁GREEN。
- 启用API RED为404!=401，复用全域host/路径转换后GREEN。测试非法JSON最初假定400，核对真实handler固定422后修正期望，未修改产品语义。
- workload未接线RED为404!=SDK400，scheduled未接线RED为404!=200，接既有SDK/tick后GREEN。
- 公开入口RED为缺少config.path；接三个入口及薄SDK helper后GREEN。
- 9纯测试：关闭零访问、原始请求保留、配置/初始化503与恢复、SDK拒绝无Bearer、tick持久ID与limit20、真实组合Origin/IP、入口配置、ID-only发送及失败ack、存储失败与pending恢复，全部通过。
- 既有native-deployment/native-runtime-config 12项通过；typecheck:netlify、lint、build、diffcheck通过。保留已有bundle>500KB提示。
- 新第10项PG组合覆盖bootstrap→登录/session→costConfigured=false→401/CSRF403→Tool202→tick发持久ID，证明tick不执行Tool/模型、不造Run。尚未执行成功。
- 主线程对抗审查发现的P1（runtime mode但无fresh marker仍可能接受旧身份/消费旧队列）已有确定RED：无marker的API实际401而期望503。补门禁后11纯项GREEN；新增消费者pool纯例证明认证后首次连接的marker缺失也不借出业务连接。PG组合进一步加入先fresh disabled时API/tick503、7张身份/操作表全无写，再enabled初始化成功继续原链。PG现在为第12项，仍未执行成功。修复后lint/typecheck通过，并已请两位独立审查者复核。
- 一次负向test-name-pattern未按预期排除PG例，固定loopback55432连接拒绝ECONNREFUSED；没有连上数据库或进行写入，不把它算产品RED或PG通过。等待主线程55433实例。

## 对抗检查与未验收边界

API返回202只表示持久受理，AWL发送成功只表示平台接收，不表示业务完成。后台Function的云HTTP202由Netlify提前返回，
会忽略函数体Response：本地closed handler返回404证明零业务访问，**不保证云端background HTTP返回404**。
同样schedule配置已存在，关闭mode仍可能每分钟被平台唤醒但不消费工作，不能继续描述“没有schedule/event订阅”。

候选`/native-api/*`已在代码声明，生产`/api/*`强制Zeabur代理未改。未设置真实平台环境值、未配置生产管理员/Secret、未写云数据库、
未调用真实模型/Tool/通知、未启用生产、未推送/部署/切流，也未关闭Zeabur。真实SDK认证成功后的云Blob持久化、事件订阅构建产物和云端定时触发须由隔离云验收确认。
