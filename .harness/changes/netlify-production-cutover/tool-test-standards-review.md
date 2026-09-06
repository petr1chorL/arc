# Tool 202 后端独立 Standards 审查

日期：2026-09-06。审查对象为当前工作区未提交后端差异；不包含本审查者实现的前端。
依据：`AGENTS.md`、`.harness/rules/`、07e Issue、已确认 HTTP Tool 202 设计和实施计划。
使用 `expert-reviewer-front` 的 Standards 维度；仓库 TypeScript 后端规则优先于技能中的 Vue 模板。

## 结论

**最终复审：0 个剩余阻断、0 个剩余建议；ST-1 与 ST-2 均已关闭。**
本次仅只读审查源码、测试和迁移；额外执行纯内存、注入 fetch 的 Node 复现与修复复核，无真实网络、数据库、密钥或生产动作，未修改实现。

## 已关闭阻断 ST-1：空 HTTP 正文会被持久化为成功

- 位置：`netlify/functions/_shared/runtime/http-tool-transport.ts:101`（解码后直接返回）及 `:75`（无条件构造 succeeded）。
- 证据：注入 `fetch: async () => new Response('')`，实际返回 `{"status":"succeeded","outputSummary":"","error":""}`；注入 `new Response('   ')` 也返回 succeeded。
- 影响：`executeToolTest` 将该 receipt 写入 Invocation，返回 succeeded；worker/transition 随后把 Operation/Invocation 都同步为成功。成功 HTTP 状态未提供任何实际工具输出，却产生了明确的完成事实。
- 规范：`.harness/rules/运行时可靠性.md` 要求空输出、超时和非法响应不能被包装成成功。不是建议扩大输出校验 Schema，而是补当前明确的最小非空约束。
- 修复方向：空/纯空白正文作为发送后的无法确认结果抛出普通错误，由 effect 保持 uncertain、Operation/Invocation 进入 needs_reconciliation；不能抛 NotSentError，也不能声称已确认未发送。补 transport 和持久 Operation 回归，确认重复消费不会重发。
- 现有测试缺口：transport 覆盖超限、非法 UTF-8/JSON、读取超时，但未覆盖有 stream 的零字节正文；`response.body === null` 检查不足以识别它。
- 修复复核：主线程加入 plain 空/纯空白和 JSON 空字符串检查，抛普通 Error 而非 NotSentError；本审查者以四种 Response 独立重放全部拒绝。新增 lifecycle 测试断言 Operation/Invocation 同为 needs_reconciliation，重复消费仍一次发送。主线程记录该回归先 RED（succeeded 不等于 needs_reconciliation / Missing rejection），后 transport+lifecycle 11 项 GREEN、Agent 29 checks 通过；本审查已读取具体测试和实现，不把该 PG 执行数字记为本人重跑。

## 已关闭建议 ST-2：3xx/5xx 提前退出也取消响应流

- 位置：`netlify/functions/_shared/runtime/http-tool-transport.ts:69`。
- 证据：注入 status=503、带 `cancel()` 计数器的 ReadableStream，函数拒绝后计数仍为 0；4xx 分支已有显式 cancel。
- 影响：该分支退出并清除总时限计时器后，未消费的响应流仍可能占用底层连接；当前没有负载证据证明已发生资源耗尽，因此不列为第二阻断。
- 建议：与 4xx 分支一致，非阻塞取消响应 body，保持原 uncertain 语义；可加受控 stream 断言。
- 修复复核：提前 throw 前已增加非阻塞 body.cancel；本审查者独立注入 status 302/503 stream，两例均拒绝且 cancel 标记为 true。未改变 uncertain 语义。

## 通过的审查项与具体边界

1. 受理通过既有 Session/Origin/CSRF/Workspace 事务入口，补 agent.write 后才入账。parameters 严格单字段 object，64KiB/深度32在 canonical hash 前检查；没有 HTTP 请求内真实发送。
2. enqueue input 只包含 assetId/parameters，actor 参与请求摘要；同键冲突等待原事务后读取既有快照，资产后续变化不重新冻结。快照、Invocation、Operation、唤醒与 accepted 审计均由外围事务提交，审计失败测试验证回滚。
3. 新快照仅 INSERT，未发现 UPDATE/DELETE 接口；新增前向 migration 未修改历史 migration。数据库仅提供主键/object约束，不应夸大为数据库角色层强制不可变或已完成生产迁移对账。
4. 新 effect 意图与资产 FOR SHARE 校验共用持有 Operation 代次锁的事务；deactivate UPDATE 行锁建立真实先后次序。两个独立 Session 的竞争测试确实观察 pg_blocking_pids，不是仅 Promise.all 假并发。
5. 发送在意图事务外。started/uncertain 不自动重放；attempt fencing 防旧 receipt 覆盖人工 retry 代次。取消在途保留待核对，晚 receipt 不推进旧业务代次；缓存成功不再次执行 active 守卫，因此符合“停用阻止新意图、不撤销在途”的已确认语义。
6. known HTTP 4xx 记录已完成 effect，但 Tool Operation 进入 failed；普通 requeue 不删除 effect，不制造第二次发送。MCP 固定未配置失败，没有真实 MCP 执行。
7. generic Operation 的写控制补 agent.write，reconcile 仍先要求 workspace.manage；jobs detail/control 对 tool.test 404。调用历史关联校验 workspace、operation/Invocation ID、kind、asset、input 及无伪 Agent/Run/NodeRun；仅严格原生关联放行新状态。
8. Tool Operation.result 由专用 transition 覆写成 ID/status/errorCode，不带参数、配置、正文；历史保留隐藏策略，错误仅固定诊断白名单。未发现新增凭证解析、日志回显或外发授权扩大。
9. native runtime 配置的 Tool Workspace/host 白名单单独显式解析并冻结，不能借用模型 host/SecretRef；关闭门禁在 loadConfig/端口访问前。默认无 Tool binding 时执行器的空白名单继续失败关闭。
10. 代码继续使用既有 runtime/ledger/worker 接缝，无新增框架、SDK、依赖或公开入口。新增四个 Node 程序已登记 verify-runtime-local；测试夹具使用固定 loopback DB、随机 schema 和 finally 清理，不读真实连接串。

## 验证解释

主线程报告的22个测试程序、7条本地浏览器与前端33项属于整合证据，不是本审查者重新执行的结果。本审查实际新证据是上述纯受控 transport 两条初始复现、最终6个受控断言通过及源码路径核查；`git diff --check` 通过。未重跑无关全量门禁、未审查自己写的前端。

当前生产宿主/AWL 公开装配、真实 Tool host 清单、生产快照迁移/对账、备份恢复及切流退役仍不由本报告签收。当前 Tool 202 后端实现与显式依赖接线在本次 Standards 审查范围内已无剩余已证实阻断。
