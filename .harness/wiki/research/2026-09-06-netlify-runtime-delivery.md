# Netlify 运行、通知与调度交付边界

核查日期：2026-09-06。仅官方文档与本地第一方 SDK 源码；未安装、部署、调用工作负载或读取凭证。
本文是 05/06 实施细则的研究输入，不是生产验收记录。

## 结论

**SDK 检查点不能保证外部副作用 exactly-once。** 本地 SDK 先执行 callback，再序列化其返回值，之后才写状态存储；在外部系统已接受动作、检查点尚未成功保存之间仍存在故障窗口。这是从实际调用顺序得出的推论，不是平台给出的 exactly-once 保证。[SDK callback](D:/project/安克知识沉淀/node_modules/@netlify/async-workloads/index.js:772)、[SDK checkpoint](D:/project/安克知识沉淀/node_modules/@netlify/async-workloads/index.js:735)

**实施建议（非平台自动能力）：** PG 保存业务任务、执行尝试与副作用账本；事件携带任务 ID/幂等键。外发使用接收方支持的幂等键；没有幂等/查询能力的提供方，超时后保留“结果不确定”，不能无条件自动重发并宣称恰好一次。该建议针对上述 callback→持久化窗口；AWL 只作为唤醒、重试和检查点机制。[SDK 顺序依据](D:/project/安克知识沉淀/node_modules/@netlify/async-workloads/index.js:721)

## 实际安装版本与 API

本地包为 `@netlify/async-workloads@0.0.106`。公开类型包含 `asyncWorkloadFn`、`AsyncWorkloadsClient`、`ErrorDoNotRetry`、`ErrorRetryAfterDelay`；事件上下文提供 `eventId/eventName/eventData/attempt/request`、`step.run`、`step.sleep`、`sendEvent`。[package.json](D:/project/安克知识沉淀/node_modules/@netlify/async-workloads/package.json:3)、[类型入口](D:/project/安克知识沉淀/node_modules/@netlify/async-workloads/index.d.ts:7)

`client.send(name,{data,delayUntil,priority})` 返回 `{sendStatus,eventId}`；构造参数为可选 `baseUrl/apiKey`。**必须检查 `sendStatus === 'succeeded'`**：实现会捕获部分发送错误、记录日志并返回 `failed`，不能只凭 `await` 未抛异常就把 PG Outbox 标为已发送。每次独立 `send()` 创建新 UUID，也不能把 AWL eventId 当成稳定业务幂等键。[类型](D:/project/安克知识沉淀/node_modules/@netlify/async-workloads/index.d.ts:22)、[UUID](D:/project/安克知识沉淀/node_modules/@netlify/async-workloads/index.js:564)、[返回失败而非抛出](D:/project/安克知识沉淀/node_modules/@netlify/async-workloads/index.js:642)

## step.run 何时持久化

官方说明：新步骤完成后重新调用整个 workload；此前步骤按 step ID 返回已存结果，步骤外代码可能每次重跑。返回值需可 JSON 序列化，step ID 必须唯一且稳定。[多步机制](https://docs.netlify.com/build/async-workloads/multi-step-workloads/)、[事件 API](https://docs.netlify.com/build/async-workloads/writing-workloads/)

0.0.106 的精确顺序为：

1. 查已有 `stepResults`；命中则解析并返回，不调用 callback。[源码](D:/project/安克知识沉淀/node_modules/@netlify/async-workloads/index.js:763)
2. 调用并等待 callback，然后 `JSON.stringify(stepResult)`。[源码](D:/project/安克知识沉淀/node_modules/@netlify/async-workloads/index.js:772)
3. `finishPendingStep` 先放入内存 pending 表；**当前所有 pending steps 完成后**，才将这批结果附加并 `await setStateBasedOnDelay(...)`。因此并行步骤 A 先完成、B 仍运行时，A 返回/完成不等于其结果已单独落盘。[源码](D:/project/安克知识沉淀/node_modules/@netlify/async-workloads/index.js:721)
4. 底层调用 Blobs `setJSON`，成功后移除 processing 状态并关闭本次处理。存储采用 strong consistency；production 默认 site store，其他 context 默认 deploy store，存在 `AWL_PERSISTENCE_CONTEXT` 覆盖机制。[状态写入](D:/project/安克知识沉淀/node_modules/@netlify/async-workloads/index.js:27)、[存储选择](D:/project/安克知识沉淀/node_modules/@netlify/async-workloads/index.js:113)、[结束处理](D:/project/安克知识沉淀/node_modules/@netlify/async-workloads/index.js:745)

所以不能把“callback 返回”“Promise resolve”“业务提交”“AWL 已持久化”视为同一个原子提交点；JSON 不可序列化也可能发生在副作用之后。[上述 callback/checkpoint 顺序](D:/project/安克知识沉淀/node_modules/@netlify/async-workloads/index.js:772)

## 重试、时限与持久状态

AWL 默认初次执行加 4 次重试；异常、拒绝的 Promise、超时进入重试规则，可配置 `maxRetries/backoffSchedule`，并用两种专用错误控制停止重试或延期。不要把它与普通 Background Function 的重试规则混算。[AWL 重试](https://docs.netlify.com/build/async-workloads/writing-workloads/)、[普通 Background Function](https://docs.netlify.com/build/functions/background-functions/)

Background Function 每次执行上限 15 分钟；Scheduled Function 上限 30 秒。前者不是整个多步工作流总寿命上限；步骤间恢复允许多次 invocation，但单步不能借此无限延长。[后台时限](https://docs.netlify.com/build/functions/background-functions/)、[定时时限](https://docs.netlify.com/build/functions/scheduled-functions/)、[步骤重调用](https://docs.netlify.com/build/async-workloads/multi-step-workloads/)

**版本差异要显式处理：** 当前官方标准函数默认超时说明为 60 秒；本地 0.0.106 `getTimeoutByFn` 未配置时仍按 27 秒减 500ms 检测，只有函数名以 `-background` 结束时选择 15 分钟减 500ms。最新官方支持 `config.background:true`，不能据此假设旧 SDK 已按该配置识别后台模式。实施时应让后台命名与 SDK 一致，并用构建产物检查确认；设置 `AWL_SERVERLESS_TIMEOUT` 只调整 SDK 检测，不提升宿主平台上限。[配置文档](https://docs.netlify.com/build/async-workloads/optional-configuration/)、[本地超时选择](D:/project/安克知识沉淀/node_modules/@netlify/async-workloads/index.js:432)、[最新后台配置](https://docs.netlify.com/build/functions/background-functions/)

事件及结果存在站点 Blobs；不能据此声称业务 PG 事务也被 AWL 原子持久化。事件 payload 官方建议小于 500 KB，并建议通过引用读取大对象。[持久化位置](https://docs.netlify.com/build/async-workloads/lifecycle/)、[payload 限制](https://docs.netlify.com/build/async-workloads/limitations/)

## 认证与触发边界

AWL 使用已知 API key 的 Authorization Bearer 认证，SDK wrapper 自动检查；这不是 ARC.ONE 的用户 Session、角色或 Workspace 授权。生产发送 API 仍需先完成业务授权，消费端依据任务 ID 回查 PG 范围及当前任务状态。[官方认证](https://docs.netlify.com/build/async-workloads/optional-configuration/)、[SDK wrapper](D:/project/安克知识沉淀/node_modules/@netlify/async-workloads/index.js:650)

不要把 `eventFilter` 当失败关闭的权限或休眠开关：0.0.106 router 在 filter 抛异常时允许消费事件。wrapper 的 Bearer 检查依然存在，但不能替代业务权限。[router](D:/project/安克知识沉淀/node_modules/@netlify/async-workloads/_internal/router.js:30)

## Branch/production 调度差别

- Scheduled Functions 仅 published deploy 自动按 cron 执行；branch/Deploy Preview 不自动定时，但可由 UI Run now 手动执行。本地也不自动定时。不能把“分支不定时”理解为“函数不可能执行”。[官方调度](https://docs.netlify.com/build/functions/scheduled-functions/)
- AWL 内部 scheduler 不同：production 连续轮询；非 production 在处理/重试等有状态动作触发后短暂运行。因此向分支发送事件仍可能启动其恢复处理。[AWL lifecycle](https://docs.netlify.com/build/async-workloads/lifecycle/)

## 默认休眠交付建议

以下是根据源码/文档作出的实现建议，不是已经应用到生产的配置：

1. 运行服务放在可测试的共享模块；未切流时不提交业务 Scheduled Function 的 `schedule` 配置，不在构建/import 时发送事件。当前仓库函数目录是 `netlify/functions`；仅“没有自定义 path”不足以代表 AWL 休眠，因为 AWL 本来由事件路由分发。[项目配置](D:/project/安克知识沉淀/netlify.toml:10)、[AWL 路由约束](https://docs.netlify.com/build/async-workloads/limitations/)
2. 休眠入口在数据库、AWL wrapper 和业务操作之前直接拒绝；保持业务事件订阅为空，发送端也默认不发送。未来正式启用时再显式接入名称、开关及 schedule。空事件不匹配由 router 的 events 比对可验证；应增加入口不初始化数据库/不发送事件的测试。[router events 匹配](D:/project/安克知识沉淀/node_modules/@netlify/async-workloads/_internal/router.js:30)
3. SDK 类型虽然包含 `status?: 'disabled'`，此次本地可见 router 未找到对该字段的运行时判断，不能单独依赖它作为已验证禁用机制；构建扩展是否在生成 mapping 时排除禁用函数仍需产物验证。[类型](D:/project/安克知识沉淀/node_modules/@netlify/async-workloads/index.d.ts:84)、[router](D:/project/安克知识沉淀/node_modules/@netlify/async-workloads/_internal/router.js:18)
4. 启用后的 Scheduled Function 只执行有界扫描/领取及发事件，依据 `sendStatus` 更新发送账本；耗时模型、通知和工作流节点交给持久化任务与 workload。依据是 30 秒时限及 SDK 发送失败返回语义，不是声称 AWL 自动提供业务 Outbox。[定时时限](https://docs.netlify.com/build/functions/scheduled-functions/)、[send 结果](D:/project/安克知识沉淀/node_modules/@netlify/async-workloads/index.js:642)

## 尚未验证

本次未运行云端 extension build，未检查站点当前配置/队列/费用，未进行真实事件或故障注入。`status:'disabled'` 构建效果、平台与 0.0.106 的后台配置兼容，需未来针对实际构建产物和隔离事件核验；不能把本笔记当作这些结果的替代品。
