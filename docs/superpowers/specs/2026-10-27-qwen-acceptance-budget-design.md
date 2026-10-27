# Qwen 全新启用验收预算保护

范围：用户授权本次模型验收费用不超过人民币1元。该切片只提供服务端可选验收保护，不自动启用生产模型，不改变正常模式，不创建开放测试API。

## 第一性原理

单次输出限制不能控制异步重复/并发总费用。因此在模型发送前持久预留预算，并限定本次验收可发送的请求内容。数据库或配置不确定时不发送；失败与未知结果不退款，重启/部署不重置计数。

## 已确认约束与设计

- `ARC_NATIVE_RUNTIME_CONFIG.acceptanceProfile` 只接受 `qwen-flash-1cny`；缺省保持既有行为。
- 固定预算ID `qwen-flash-1cny-20261027`，最多20次，每次预留0.05元；此数字是保守预算额度，不写入美元账单字段。
- SQL单语句原子INSERT/条件UPDATE/RETURNING持久预留，数据库失败、额度耗尽、release失败均禁止外发；不自动退款。
- 验收只允许Workspace `arc-one`、普通按量端点 `https://maas.qianwenaiapi.com/compatible-mode/v1/chat/completions`、模型 `qwen3.8-flash`、Secret Ref `ARC_QWEN_API_KEY`。
- 只允许现有gateway生成的system/user纯文本两消息；序列化体最多8192字节；输出上限 `min(max_tokens,512)`，改用 `max_completion_tokens`，明确 `enable_thinking=false`、`stream=false`；禁止额外请求字段、图片、工具、搜索、多候选或其他端点。
- profile启用时remote拒绝，Tool allowedBindings强制为空；缺省通知适配器不外发。若有其他外发面不得启用profile。
- mode关闭时无预算依赖访问；profile未启用时无预算池构造。只有实际外发前才加载SqlPool。
- 新表经前向迁移发布，不修改已应用迁移，不直连生产DDL/DML。

## 价格与协议依据（2026-10-27）

[实际普通端点所属官方价格](https://platform.qianwenai.com/docs/developer-guides/getting-started/model-prices)：输入/输出0.8/2.7元每百万tokens，不分区间；主线程已核实。纯文本8KiB输入加协议少量开销，保守按10000输入token和522输出token估计，约0.00941元，小于每次0.05元预留。该保护不约束同一Key在其他应用的消费。

[实际端点官方示例](https://platform.qianwenai.com/docs/developer-guides/getting-started/latest-model)使用maas端点，支持enable_thinking=false。

[官方Chat协议](https://help.aliyun.com/en/model-studio/qwen-api-via-openai-chat-completions)：`max_completion_tokens`包含思考和答案，可能有最多10token偏差；Qwen3.5-Flash及以后支持；`enable_thinking=false`直接放HTTP body。

## 文件与实施计划

1. `scripts/runtime-acceptance-budget.test.mjs`：先证明profile请求限制与持久预算行为缺失。
2. `netlify/functions/_shared/native/acceptance-budget.ts`：精确绑定、体校验/转换、持久原子预留和拒绝外发。
3. `native/runtime-dependencies.ts`、`native/platform-host.ts`：可选profile解析与惰性池装配；不影响关闭/普通模式。
4. `netlify/database/migrations/20261027070000_acceptance-budget/migration.sql`：固定预算约束表；测试fixture加载新迁移。
5. `scripts/verify-runtime-local.mjs`纳入测试；Node runtime测试名自动被Vitest排除；执行定向纯测试、类型/lint及真实PG CI，记录未运行的本地PG。

## 对抗式验收

覆盖并发超额、重新创建assembly不重置、发送错误仍扣预留、DB/释放错误不外发、不合规host/path/model/messages/字段不预留不发送、已有mode off与无profile兼容。合成fetch/内存计数测试不是生产真实模型验收或PG竞争证明。
