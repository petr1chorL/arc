# 生产切流装配与契约就绪审查

日期：2026-09-06。性质：独立只读源码核查；只新增本报告，没有读取凭证、访问生产或修改实现。

## 结论

04A–06 已有较完整原生业务模块，不能把入口休眠误写成业务尚未实现；但当前 checkout **还不能直接移除 Zeabur 代理并关闭旧服务**。除生产装配和真实迁移证据外，仍有明确的契约缺口，以及旧非终态运行不能直接恢复的转换边界。

阅读：AGENTS、CONTEXT、PROJECT_WORKFLOW、项目总览及 CURRENT_IMPLEMENTATION 最新段、原生迁移 PRD、07/08 Issue、Netlify Functions Skill。该 Skill 用于核查 API、Background、Schedule 的不同入口与时限，未执行其示例命令。

## 已实现与缺口的准确边界

使用当前旧 `apps/api/app/main.py` 的 `@router.get/post/put/patch/delete` 装饰器提取 107 条 Workspace 路由，将占位符替换为合成 ID，实际调用 9 个原生 resolver。102 条能解析，5 条不能解析。这是路由存在性检查，**不是 102 条响应契约已重新验收**；身份路由另由 `identity-workspace/routes.ts` 覆盖，health 独立核查。

| 未匹配旧路由 | 旧实现证据 | 影响与最小修复 |
|---|---|---|
| POST `/model-providers/{id}/migrate-drafts` | main.py:2692 | 草稿 Provider 迁移 API 未接入；补同 Workspace/草稿校验、事务审计及契约测试，不能把固定历史版本改写为新 Provider。 |
| POST `/model-providers/{id}/test` | main.py:2811 | 旧实现仅检查配置及 Secret 是否存在，并不真的请求模型；可装配安全的 Secret 存在性端口，保留旧响应，不能声称真实模型连接成功。 |
| POST `/asset-library/{id}/test-invocations` | main.py:2851 | 资产测试按钮 runtime 模式仍禁用；运行内 HTTP Tool 已实现，不等于独立资产测试端点存在。复用受控 Tool/effect 端口，按获批 202 策略补 API/UI/测试。 |
| POST `/execution-jobs/next` | main.py:3558 | 旧手动 Worker 领取契约消失；AWL 架构不应重新开放任意同步执行。明确 409/410 退役响应及客户端边界，而不是静默 404。现 heartbeat 已明确 409 仅内部租约，属于有意安全变化。 |
| DELETE `/runs/{id}` | main.py:3812 | `src/pages/Runs.tsx:331` 仍调用删除，没有原生删除路由，会 404。需保留旧删除的授权/审计，并纳入新 Operation/effect/检查点引用约束；有未终态或不确定外部动作时不得把删除当作取消。 |

`runtime-closure/postgres.ts:21` 的旧 Review 决策返回明确 409、要求 HumanTask 决策链，不算漏实现。应把该差异与 202、Worker 领取的退役共同记录为迁移契约差异。

## 上线前必须装配

1. **一个可测试的全域 API composition**。`runtime/router.ts:12` 只组合 runtime/closure/delivery 三域；身份、Provider/Tool、Agent、DataObject、Rubric、Feedback、Workflow 的组合目前只在 `scripts/runtime-e2e-server.mjs` 测试夹具存在。不能把测试服务器的合成身份、控制端点或 transport 带入生产。应提取纯 factory，统一可信 `context.ip`、允许 Origin、数据库连接和未知路由响应；新增 `/api/health` 的原生明确路径。
2. **生产运行依赖**。`runtime/service.ts:13` 要求 `complete`，可选 remote/Tool/Judge/通知；`runtime/gateway.ts:41` 只有 factory，没有生产入口装配。必须通过非密钥配置解析 Workspace+Host+SecretRef 精确绑定，运行时使用 `Netlify.env.get(ref)` 解析引用；合法成本配置及 `costsConfigured` 口径一致。不要以全局 Key 回退掩盖绑定缺失。
3. **AWL 与定时入口**。`runtime/netlify.ts:14,24` 已有 consumer/tick，可复用；`runtime-workload-background.mts` 当前 events=[] 且返回404，scheduled 无 schedule，runtime 无路径。需接通经过 SDK 鉴权的 consumer、仅发送 operationId 的 sender 和有界 tick，实际验证云端投递/重复事件/部署中断后的恢复。依赖已在 package.json，无需因入口休眠重新安装 SDK。
4. **切流与前端能力配置同一版本**。`netlify.toml` 的强制 `/api/*` Zeabur 代理必须在正式冻结/对账后切换。`src/api/migrationCapabilities.ts:3` 仅 `VITE_ARC_ONE_MIGRATION_MODE=runtime` 开启新模式；runtime 同时继承 reference-assets 模式，Provider/Tool 测试仍关闭，需与上表接口补齐同步调整，不能仅切后端。
5. **通知能力按实际旧生产配置核查**。`runtime-delivery/notifications.ts` 已实现持久 in_app，其他渠道需要显式 adapters，默认没有真实外发 adapter。未查询生产渠道，不能判定是否有迁移阻断；若旧生产只使用 in_app，不应为迁移额外发明飞书/邮件集成。若有真实渠道则须迁移相应 adapter 和配置后真实验收。

## 数据与旧运行的关键切换门槛

仅导入旧表不等于旧任务可以由新引擎继续执行：

- `runtime/postgres.ts:70` 明确拒绝没有原生账本的历史失败恢复。
- `runtime/workflow.ts:218` 只根据 `runtime_node_checkpoints` 判断哪些节点已完成。旧 `node_runs` 不能自动充当检查点。
- 人审决策能建立新的 `human.resume`，但旧待审核 Run 若没有原生检查点，恢复执行可能从上游重新开始；这不仅是状态展示问题，涉及重复模型/Tool 外部动作。
- 原生 `jobs.list` 查询 runtime_operations，不展示旧 execution_jobs 队列；仅保留旧队列表不会让 AWL 接管它。

最小安全路线：冻结新提交/计划及旧 Worker 新领取，等已执行中的动作落入明确终态；盘点剩余 queued/running/waiting-review/待恢复/通知 pending。若仍有必须跨平台续跑的实例，先实现并测试显式旧账本→原生检查点转换（含原节点/产出物/人审引用），不能临时生成“成功 effect”掩盖未知结果。若生产不存在这些实例，则以零数量/状态对账证明无需转换。不得自行取消真实待审核任务来凑零。

07 Issue 要求的可恢复备份、校验值、最终增量独立对账和单主回滚演练，以及 08 的稳定观察和关闭后复验，本次只读源码检查均未执行，不能被本地 05/06 测试数字代替。生产主写以后，回滚不能只改代理回旧库，否则丢失 Netlify 新写入。

## 建议最小顺序

1. 补全域 composition、上述明确端点/退役契约与生产依赖解析，保持生产切流开关关闭；本地契约及有界入口测试。
2. 隔离 Preview 对应完整 SHA，应用新增 schema、真实 AWL/调度和受控真实业务验证。
3. 生产只读盘点后确定是否需要旧非终态转换；验证备份可恢复，再冻结单主、最终导入与独立对账。
4. 同一版本切 API/前端并验收；保留旧资源只读回退。达到可检查稳定窗口后再关闭 Zeabur，关闭后复验。

本报告没有宣称生产现有数据量、凭证可用性、实际外发配置或稳定观察结果；这些由主线程的授权生产检查补证。
