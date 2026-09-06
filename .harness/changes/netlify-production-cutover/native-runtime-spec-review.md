# 原生运行依赖工厂 Spec 轴独立审查

2026-09-06。输入：native-runtime-dependencies.md 的设计/AC；
`native/runtime-dependencies.ts`、`scripts/native-runtime-config.test.mjs`；追踪现有runtime/gateway。
本报告只做Spec轴；Standards由另一位独立审查者记录，未修改实现或生产配置。

## 结论

限定“生产依赖纯工厂”切片的AC已满足，**未发现阻断问题**。
可以进入主线程整合及CI，不是公开Function、AWL、云端调度或生产迁移放行。

## AC 逐项核对

1. **默认关闭且不读取**：仅严格runtime启用。关闭分支在loadConfig、Secret resolver与fetch getter访问之前返回null。
   缺失、空白、大小写差异与其他模式均有getter抛错测试证明零读取。
2. **显式非密钥配置**：字段白名单、明确bindings数组、Workspace/Host/SecretRef格式、重复项、最大60秒总时限。
   绑定复制并冻结，后续改调用者原对象不会修改批准范围；host规范化后再判重。
3. **绑定先于Secret**：Gateway复用既有HTTPS/443/无认证信息及query/hash的URL守卫和
   Workspace+hostname+Ref精确绑定；Provider存在性同样先isApprovedProvider，再解析Secret。
   错Workspace/host/ref和非法URL测试均证实零解析、零发送；没有隐式全局key回退。
4. **配置费率准确传递**：双费率必须同时提供且非负有限，极大费率在发送前按既有Token上界拒绝溢出。
   显式双零标记costConfigured=true，双省略false。受控1000输入/500输出、费率2/4得到0.004 USD。
   此标志仅表示配置存在，不代表不同生产模型账单已经核定。
5. **错误保持发送前边界**：配置异常统一固定NotSentError；Secret缺失、解析异常、空白、CR/LF不会发送，
   不回显输入配置或解析器异常正文。正常构造不会实际读取Secret，只有受控调用或获准存在性检查才解析。
6. **未扩展授权面**：依赖只装配既有Gateway；notificationAdapters/toolOptions未注入，没有创建模型任务、
   数据库连接、AWL事件或生产平台访问。存在性检查不等价模型网络测试，相关边界已明确。

## 独立新证据

`node --experimental-transform-types scripts/native-runtime-config.test.mjs`：
**5 passed / 0 failed，24.54ms**。使用合成域名与注入fetch，未读取真实环境、数据库或凭证。
已有Gateway源码的complete/remote都会先通过headers绑定校验再解析；费用计算沿用既有契约。

## 保留的未验收边界

- providerOptions/closureOptions尚待真正宿主连接，不因本工厂存在而自动启用API。
- 本模块不拥有Session/RBAC；Provider端口调用者必须继续经过已审查的参考资产HTTP授权链。
- 真实通知、HTTP Tool许可、生产各模型费率、Netlify环境读取、AWL鉴权投递及定时入口不属于本切片。
- 本报告不评价备份/任务转换/切流/观察或关闭Zeabur；主线程不得据此写这些阶段已完成。
