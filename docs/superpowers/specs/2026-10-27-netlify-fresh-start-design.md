# Netlify全新启用：受控身份初始化与原生接线

状态：根据用户明确的全新启用、无需历史数据、验收后关闭Zeabur授权实施。
本设计不授权付款、清库、复制旧凭证或提前停用旧服务。

## 第一性原理

新业务必须独立拥有身份、固定资产版本、持久Operation、审核和追踪，不需要旧账本。
当前内部后端已实现但公开入口休眠；只删除Zeabur代理会直接使系统不可用。
先把部署边界接通且默认关闭，再初始化新管理员并验收，最后切换入口/停用旧服务。

## 切片A：一次性初始化

- 使用已有PostgreSQL与Argon2密码实现；不新增开放注册或任意SQL接口。
- 新增前向migration的单例初始化标记；事务锁串行化，组织、Workspace、管理员、成员与审计同事务。
- 默认禁用。仅服务端明确开启初始化时读取平台配置；调用方不能指定管理员或密码。
- 首位管理员邮箱由用户确认，实际配置放平台变量，不将其或密码编入测试/种子数据。
- 初始密码由用户在Netlify安全入口设置，代码仅在服务器读取并哈希；不输出或回传密码。
- 已有完成标记后不再读取初始密码，也不重置任何用户；没有标记但已有组织/用户/空间则拒绝初始化。
- 不因不迁历史就清空目标库。初始化配置错误、弱密码、部分目标状态、审计失败均不得留下半套身份。
- 身份初始化不自动授予业务专家审核资格；后续通过真实管理接口配置。

## 切片B：平台入口

- 复用native/api-host、runtime/netlify和现有网关，不重写已验证业务域。
- ARC_NATIVE_MODE只有精确runtime启用；关闭时不读数据库/运行配置/Secret/发送器。
  依赖SDK在模块载入时可能读取NODE_ENV元数据；独立入口测试只允许该元数据和应用模式标记，不允许其他值。
- 非密钥运行配置来自ARC_NATIVE_RUNTIME_CONFIG；未配置时使用空绑定，禁止隐式开放模型/Tool出口。
- 初始化开关ARC_FRESH_START只有enabled启用；邮箱ARC_INITIAL_ADMIN_EMAIL和密码ARC_INITIAL_ADMIN_PASSWORD。
- 全新模式下，API初始化步骤之后、scheduled进入业务tick之前、workload通过SDK认证后进入业务消费之前，
  都必须确认本目标库的初始化完成标记存在。缺失时API/tick返回503；消费者抛固定脱敏失败交SDK处理重试，
  不承诺后台HTTP返回503。三者均不执行业务，防止误用未知旧身份或处理旧队列。
  该检查不读取初始密码；不能以ARC_NATIVE_MODE单独证明目标库已经全新初始化。
- API保留Context.ip作为受信限流来源；不信任客户端伪造forwarded头。
- 补齐已有GET /api/health契约（候选为/native-api/health）：通过初始化门禁后真实查询数据库；
  仅返回ok及netlify-native标识，数据库异常503且不回显原文，不用静态200制造假健康。
- /native-api/*为过渡验收入口，内部仅归一化为已有/api/*路由；保留同源、正文大小、身份和CSRF校验。
- 候选Function只注册/native-api/*，不与旧/api/*产生路由优先级竞争。
  原生候选验收后再将/api/*加入Function路径并移除旧代理，使其由原生Function接管。
- AWL只发送Operation ID，以SDK认证事件消费；Scheduled Function调用有界tick，不同步执行模型。
- 使用现有站内通知语义，不把未配置的外部通知适配器报告为真实送达。
- 前端必须实际使用原生runtime模式；不得把休眠/合成状态误报成全新系统已上线。

## 文件与实施顺序

1. netlify/functions/_shared/native/bootstrap.ts、前向migration及scripts/runtime-bootstrap.test.mjs：先RED再GREEN。
2. native平台装配模块、runtime.mts、runtime-workload-background.mts、runtime-scheduled.mts及定向测试：默认关闭、错误隔离及真实组合验证。
3. scripts/verify-runtime-local.mjs纳入新测试；相关lint/build与隔离数据库验证、双轴复审后提交。
   src/api/http.ts与http.test.ts增加VITE_ARC_ONE_API_BASE_PATH=/native-api的同源过渡入口；
   必须搭配VITE_ARC_ONE_MIGRATION_MODE=runtime，仅重写已有相对/api路径，不允许外部主机。
4. 精确SHA通过CI后云构建；平台密钥由用户安全设置，不通过聊天索取；API/数据库验收不依赖浏览器控制工具。
5. 用户登录确认新管理员、创建/运行/审核流程；记录真实模型/通知验证范围，再切换并观察。
6. 明确核实ARC专属Zeabur服务，验收后停用，不删除共享资源；停用后再次复验Netlify。

## 对抗式验收

- 禁用模式零依赖访问；未认证、错误Origin/CSRF、跨空间请求仍拒绝。
- 并发初始化只创建一套身份；中途失败回滚；配置变更不重置已有密码；非空目标拒绝。
- 202后存在持久结果，未知外部结果不自动重发；不把单次200当成稳定观察。
- Cloud部署失败不绕过CI/Secret扫描，不为故障直接放宽沙箱/审批或修改生产数据。
- 本地测试使用合成账号/发送器；真实验收未完成前保持Zeabur，不宣称目标已完成。
