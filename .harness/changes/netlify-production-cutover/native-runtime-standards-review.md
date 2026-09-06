# 原生运行依赖工厂 Standards 独立审查

日期：2026-09-06。范围：`native/runtime-dependencies.ts`、`scripts/native-runtime-config.test.mjs`，
并追读现有 runtime/gateway.ts、worker.ts、types.ts 和 deployment.ts 的调用边界。
本报告仅 Standards 轴，Spec 轴由另一审查者独立完成；使用 expert-reviewer，Vue 模板项不适用。
没有改实现、配置、Secret、公开 Function 或生产状态。

## 结论

当前纯工厂范围未发现严重规范/安全问题。可交主线程整合；不能据此声称宿主接线、真实价格、
AWL 投递或生产迁移已经完成。`costConfigured` 仅表示明确提供双费率。

## 配置校验与类型

- loadConfig 返回 unknown，解析器先限制普通/null-prototype 对象、字段白名单及数组，逐条重建 Binding，
  不使用 any，也不直接把未知对象断言成有效运行配置。
- Workspace/SecretRef 使用固定模式和长度；host 转小写后要求 DNS label 格式、长度、至少两段，
  禁 IP/端口/scheme/path/wildcard/末尾点。额外 URL hostname 规范化比对拒绝数字 IPv4 简写。
- 绑定按归一化后的完整三元组查重；同 Host 不同 Workspace/SecretRef 是显式允许关系，不是隐式全局权限。
- requestTimeoutMs 必须1..60000整数；missing使用默认值，null和非数值拒绝。双费率要求同时给出或同时省略，
  NaN/Infinity/负数/string 拒绝，双零是有效显式配置。

## 成本溢出

Gateway 将每个 usage token 限制在1e9以内；工厂要求每个非负费率乘2e9仍有限，因此
`promptTokens*inputRate + completionTokens*outputRate` 的最坏值不会超过已检查的双项上界。
Gateway 在接收结果后还验证最终costUsd有限非负，remote成本另有现成1e9上限。
该防护针对数字溢出，不意味着全局统一费率能准确表示生产中不同 Provider/模型的实际计费。
既有 Gateway 直接构造调用者不自动获得工厂的更严格配置校验，生产宿主应使用已审查工厂。

## Secret、默认关闭与错误边界

- 仅 mode精确runtime开启；关闭分支早于读取loadConfig、resolveSecret/fetch属性，测试以getter验证零触达。
- 构造时只校验非密钥配置，不解析Secret、不发请求。实际执行由Gateway先匹配Workspace+host+ref，再解析。
- Provider存在性接缝也先限制HTTPS443、无用户信息/query/hash，再精确匹配三元组；不匹配直接false。
- 没有process.env/Netlify.env读取，没有隐式全局Key、备用ref、默认host或未获准后重试其他Provider。
- loader/parser失败转固定NotSentError；resolver异常、非string、空白和CR/LF值转固定发送前错误；
  Secret仅经注入端口在被授权发送时进入Authorization，不进入配置对象、响应、日志或审计。
- 现有Gateway transport异常不应直接当HTTP响应：运行链路通过ctx.effect把不确定错误转换为固定UncertainEffectError，
  worker最终保存固定错误文案；Provider handler也有共享异常503脱敏。工厂本身不提供同步业务HTTP执行入口。

## 配置复制隔离与架构

- 每个Binding重建且Object.freeze，bindings数组和配置对象也freeze；外部修改原始bindings不会扩大
  Gateway或Provider存在性白名单。费率/时限是复制后的primitive，不保留对原对象字段的动态读取。
- 只装配已有Gateway complete/remote与costConfigured/secretPresence接缝，不添加模型SDK、通知adapter、
  Tool白名单或数据库依赖；没有把本地fixture/synthetic输入带入生产工厂。
- 返回的dependencies/providerOptions/closureOptions供宿主使用，尚未代表现有router会自动采用这些options。
  这一未接线边界已在作者回执明确，不作为纯工厂代码的虚假完成项。

## 独立新验证

- `node --experimental-transform-types scripts/native-runtime-config.test.mjs`：5 passed，26.540ms。
- `node --experimental-transform-types scripts/runtime-gateway.test.mjs`：4 passed，356.561ms。
- 只使用合成Secret文本和注入fetch；没有读取环境值、实际联网或访问数据库。
- 作者回执已有lint/typecheck；本轴未重复机械门禁，最终增量build/CI由主线程承担。

## 非阻断测试增强建议

当前测试验证了parser与Provider端口原对象变更隔离；以后可再直接调用Gateway complete验证同一变更
仍被拒绝，并补费率恰在允许上界时双1e9 token结果有限的案例。当前闭包引用的是同一个冻结config，
代码检查已能确认隔离与溢出界限，这两项不是已发现的功能缺陷。
