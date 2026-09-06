# HTTP Tool 202：独立 Spec 轴审查

日期：2026-09-06。审查者：`ci_workflow_fix`，未参与本切片实现；仅写本报告。

## 结论

当前审查范围内未发现未关闭的严重问题。最初发现的页面响应丢失重试更换幂等键问题，
已由主线程修复，审查者独立复核通过。本结论不是 Standards 轴报告，也不替代主线程的
完整门禁、浏览器验收或生产准入；未访问生产、真实凭证或真实 Tool 服务。

依据：`docs/superpowers/specs/2026-09-06-http-tool-test-operation-design.md`、对应实施计划、
`.scratch/netlify-native-migration/issues/07e-http-tool-test-operation.md`。
按 `expert-reviewer-front` 的独立 Spec 轴检查实现、失败路径与错误完成感；没有套用 Vue 模板默认要求。

## 发现与关闭

### 已关闭：丢失受理响应后页面重试会产生新发送身份

初审时 `src/pages/AssetLibrary.tsx` 的 `runTestInvocation` 没有传 API 已支持的显式 key，
每次点击均由 `operationRequestHeaders` 新建 UUID。复现条件：服务端受理事务成功，客户端没有
拿到响应；同一页面、相同参数再次点击。旧实现产生两个 key，因此后端正确去重也无法阻止
两个独立 Operation/effect。仅测试 API 接受可选 key，不能证明页面实际复用它。

主线程按反馈先建立明确的 UUID 不同 RED，再修复页面；独立复核当前
`src/pages/AssetLibrary.tsx:86`、`:220`—`:228`：按资产保存当前 actor、参数与 key，
请求失败保留，确认响应后才清除；Workspace keyed panel 不共享该状态。
`src/pages/AssetLibrary.test.tsx:69` 覆盖失败后的 key 相同，以及确认受理后再次明确提交 key 不同。
本审查独立运行页面/API/OperationProgress 三文件，27 项全部通过。

## 通过项与具体证据

| Spec 关注点 | 源码与验证 |
| --- | --- |
| 独立受理，不伪造 Run | `reference-assets/tool-test-postgres.ts:15` 使用固定 `{assetId,parameters}` 和 actor 摘要；Operation ID 同时关联 Invocation/snapshot，Agent/Run/NodeRun 为空。PG 验证没有 workflow_runs 行。 |
| 原子性与幂等 | 同调用方事务写 Operation、outbox、snapshot、Invocation、accepted audit。两独立 Session 同键仅一个对象组；配置改变后同键仍原快照；不同参数 409；强制审计写失败整体回滚。 |
| Session/Workspace/能力 | 复用实际 identity request parser 与 workspaceContext；创建 `agent.write`，generic controls 在原能力门禁上再按 kind 检查 `agent.write`；`runtime/postgres.ts:49` 拒绝 Tool 的 jobs aliases。operator 控制 403、alias 404、builder 允许的实际 PG 请求通过。 |
| 停用与意图的顺序 | `runtime/worker.ts:54` 的 beforeIntent 在 effect 意图事务内执行；Tool 对资产 FOR SHARE 与停用 UPDATE 竞争。两个独立 Session 的真实 PostgreSQL 锁屏障证明先停用不发送、先意图可保留在途结果。缓存成功跳过新意图检查。 |
| 未知结果不是失败重试 | transport 异常进入 needs_reconciliation；普通 requeue 拒绝；显式风险确认才推进 attempt。取消在途发送保留未知证据，晚到 receipt 不推进过期业务代次；后续使用缓存不重复发送。 |
| Invocation 与 Operation 同步 | `runtime/service.ts:97` 与 `runtime/controls.ts:41` 在终态/接管/control 事务调用 synchronizeToolTest；固定结果不包含参数或外部正文。独立补充探针证明超期 started 意图使两表同步待核对，并证明 Invocation 写入失败会回滚整个 control。 |
| known-failed 不制造成功 | HTTP 4xx 与 MCP 未配置产生 failed Operation、failed Invocation 和固定诊断。独立补充探针证明 4xx 的 requeue 仍 failed 且不新增发送。 |
| 历史查询与隐私 | `reference-assets/history-postgres.ts:101` 校验 Workspace、op kind/ID、effect 关联、snapshot、asset 与空运行关联才接受新状态；损坏关联仍 409。原生正文隐藏，accepted 审计显式 phase；OperationProgress 对 tool.test 隐藏原始 result。 |
| 前端状态与权限 | 202 只提示受理；Invocation 失败刷新只重试读取；Workspace 切换/卸载晚到结果不写旧页面；Operation 控制按 kind 使用资产管理权限，reconcile 保留管理能力。27 项前端测试涵盖这些路径。 |
| transport 与宿主配置 | `native/runtime-dependencies.ts:36` 独立解析 toolBindings，`:91` 装配，不借用模型 host/secret；工厂关闭不读取端口。共享传输保留独立 POST parameters、GET Python/httpx 参数语义；Agent 仍显式 `{input}`。HTTPS/Host、redirect、总超时、响应上限、坏 UTF-8/JSON 与固定诊断均有定向测试。 |

表内路径省略共同前缀 `netlify/functions/_shared/`，前端路径除外。

## 本审查独立执行的证据

1. `ARC_RUNTIME_TEST_PORT=55433`，Node 三文件：
   `runtime-tool-test-operation`、`runtime-tool-test-lifecycle`、`runtime-tool-test-races`：
   **11/11 pass，2.991s**。首次 sandbox 子进程 spawn EPERM 是工具限制，获准执行后取得上述真实结果。
2. Vitest `src/pages/AssetLibrary.test.tsx`、`src/api/assetLibrary.test.ts`、
   `src/components/OperationProgress.test.tsx`：**27/27 pass，4.08s**。
3. Node `scripts/runtime-tool-transport.test.mjs` 与 `scripts/native-runtime-config.test.mjs`：
   **12/12 pass，0.802s**。Python/httpx 仅使用现有本地安装与合成参数，无真实网络调用。
4. 三项独立合成探针（复用 runtimeTestDatabase 随机 schema，未创建新测试文件）：
   - HTTP 400 完成后 requeue、再次消费：状态仍 failed，fetch 总计一次；
   - 将合成任务置为过期 running 并插入 started effect，再消费：不发送，Operation 与 Invocation
     均为 needs_reconciliation；
   - 添加只在测试 schema 生效的 Invocation canceled CHECK 失败约束后调用 cancel：503，
     Operation 仍 queued、Invocation 仍 pending，证明不能只提交一侧状态。
   三项均 PASS；fixture finally 删除随机 schema 并确认不存在。未启动或停止容器。

## 非阻断边界，不能夸大

- 页面 pending key 是内存态：保证**当前页面同一提交**在响应丢失后的显式重试，不保证刷新/卸载后
  自动找回该 key。已提交 Operation 可从持久 Invocation 历史/ID恢复；页面不会自动重放写请求。
  响应丢失且刷新后再次点击测试必须理解为新提交，不能宣称跨刷新 exactly-once。
  建议 UI/回执明确先查历史；若将来需要跨刷新恢复未知受理身份，应另定 key/摘要持久化、清理与
  actor/Workspace 边界，不为此把原始参数写入 localStorage。
- 本审查没有把主线程当时仍在补的 transport/toolBindings/浏览器接线重复报告为缺失；接线完成后
  已刷新读取源码并独立运行 transport/工厂测试。全量 22 程序、浏览器及 lint/build 以主线程新回执为准。
- MCP 只有明确未配置失败，不是真实 MCP；此报告不评价公开宿主/AWL 云端消费、生产数据库迁移、
  Secret/真实渠道、Run 删除剩余缺口或关闭 Zeabur，不能据此宣称切流完成。
