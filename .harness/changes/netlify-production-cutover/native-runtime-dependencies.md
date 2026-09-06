# 原生运行依赖工厂：设计与验收

日期：2026-09-06。状态：local-pass，独立 Spec/Standards 两轴审查通过，见同目录对应 review。范围：生产依赖纯工厂切片。

## 实现前设计

底层目标：生产宿主可以使用显式、可校验配置装配已有 Gateway，而不是把合成服务器配置带入生产。
必要对象：Workspace + HTTPS hostname + SecretRef 精确绑定、输入/输出成本率、请求总时限、注入的 Secret 解析和 fetch 端口。
先实现这条纯接缝，才能独立验证配置错误不会导致外部发送或凭证探测；这不是 AWL 云端验证。

新增 `native/runtime-dependencies.ts` 和 `scripts/native-runtime-config.test.mjs`：

1. `parseNativeRuntimeConfig(unknown)` 只接受字段白名单内的非密钥对象；拒绝不合法/重复绑定。
   bindings 为显式数组（允许空数组关闭所有模型/远程调用），host 为不含 scheme/path/port/IP/wildcard 的 DNS hostname；
   Workspace 非空标识、SecretRef 为环境变量名格式。请求 URL 仍须 HTTPS、443、无用户信息/query/hash。
2. 成本率必须同时给出或同时省略，均为有限非负数；显式双零表示已配置免费费率。
   同已有契约使用 `costConfigured`（单数），不是发明 `costsConfigured` 字段。省略双费率时 false。
   费率沿用现有 Gateway 的统一 input/output rates 语义，不声称已按生产不同模型核定真实价格。
3. `createNativeRuntimeDependencies({mode, loadConfig, resolveSecret, fetch?})` 仅精确 runtime 开启；否则返回 null，
   不调用配置 loader，不访问解析端口，不初始化数据库/SDK。开启时先解析配置，再创建已有纯 Gateway。
4. 返回 `{dependencies, providerOptions, closureOptions}`。dependencies 沿用 RuntimeDependencies；不注入真实通知或 HTTP Tool 白名单。
   Provider secretPresence 必须先校验绑定；不匹配直接 false，不探测任意 SecretRef。解析异常仅抛脱敏的发送前错误。
5. 本次不改已审查 router/deployment、公开 Function、netlify.toml、CI；宿主接线由后续独立验证完成。

## 计划与验收标准

- 先写关闭时 loader/Secret/fetch 零调用测试并记录 RED，再最小实现。
- 测配置拒绝、双成本率含零、绑定复制隔离、实际执行延迟解析和错 Workspace/host/ref 的零发送。
- 测合法受控响应的成本及 Provider 存在性，只使用合成文本与 example.invalid 域名。
- 聚焦测试 + 既有 Gateway 回归 + Netlify typecheck + lint；不访问真实环境或安装包。
- 对抗检查：默认开关、错误泄漏、隐式全局凭证、调用者可变对象绕过白名单、未真实计费却显示已配置。

## 验证回执

- RED 1：目标模块不存在，测试得到 ERR_MODULE_NOT_FOUND；实现关闭分支后 GREEN。
- RED 2：显式合法配置被占位 parser 拒绝；实现白名单/绑定/双费率/时限解析后 GREEN。
- RED 3：工厂没有 RuntimeDependencies/closureOptions；装配既有 Gateway 后受控调用费用断言通过。
- RED 4：Provider secretPresence 不存在；新增精确绑定后的延迟存在性端口并验证错误地址零解析。
- 对抗补充 RED：极大有限费率能造成 Gateway Token 上界乘法溢出；现已在发送前拒绝。
  非标准数值 IPv4 alias、无效数值 hostname 与 null 时限均被拒绝，错误不包含输入配置值。
- `node --experimental-transform-types scripts/native-runtime-config.test.mjs`：5 passed，23.9 ms。
- `node --experimental-transform-types scripts/runtime-gateway.test.mjs`：4 passed，342 ms。
- `node --experimental-transform-types scripts/native-deployment.test.mjs`：6 passed，30.4 ms。
- `npm run typecheck:netlify`、`npm run lint`：通过。

所有执行使用注入的合成响应，不调用实际数据库、SDK、模型/远程服务或生产配置。
类型检查覆盖新增纯工厂；本次没有改动前端/构建配置，主线程负责整个增量的最终 build 与云端门禁。

## 对抗式检查与剩余边界

- 拷贝并冻结解析后的绑定，调用者修改原始对象不会扩大 Gateway 或 Provider 存在性白名单。
- Unknown/missing 模式返回 null；关闭时 loadConfig、Secret/fetch 的 getter 均没有触发。
- 禁止 HTTP、非 443、用户信息、query/hash、错误 Workspace/host/ref 的存在性检查；这些请求不会探测 Secret。
- 解析失败是发送前 NotSentError，真实解析错误正文不会向消费者泄漏；Secret 值只在实际受控发送时进入授权头。
- costConfigured 仅表示显式双费率已配置，并非已核实生产账单准确；缺省两费率仍沿用 Gateway 零计量但标记 false。
- 返回 providerOptions/closureOptions 接缝尚未传入已审查 router，这种独立分层不会自动启用公开 API。
- HTTP Tool、真实通知、生产不同模型计价、实际 AWL 鉴权/投递、云端 tick、迁移/切流/退役仍须单独盘点和验证。
- Netlify Functions Skill 用于坚持平台环境读取应在宿主、Background/Schedule 不混入同步 API 的边界。
  本切片不调用或修改 SDK，不需要引入新的平台依赖或读取平台凭证。
