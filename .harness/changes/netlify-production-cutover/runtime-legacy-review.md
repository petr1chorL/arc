# 原生旧执行控制独立审查

日期：2026-09-06；只读实现，仅新增本报告。范围为同日 runtime-legacy-control-compat 设计/计划。
使用 expert-reviewer 的 Spec 与 Standards 两个维度；主线程已分派独立审查，本报告不再嵌套委派。

## 结论

过渡诊断契约未发现严重问题，可作为明确拒绝旧操作的兼容改进整合。
**Run 删除成功能力仍未迁移，不能据此把五条旧接口等价迁移或第 5、6 步标完成。**
本报告不代表已验收生产、AWL、数据迁移或 Zeabur 退役。

## Spec 轴：需求匹配

- `runtime/handler.ts` 只新增精确 POST execution-jobs/next 与 DELETE runs/{id}；两者属于写入口，
  复用 Origin、正文大小及固定错误响应，不是直接暴露迁移说明的无认证端点。
- `runtime/postgres.ts` 先 workspaceContext(write=true) 再 requireCapability(run.execute)。
  身份、CSRF、Workspace 与权限不通过时，不能到达 410/既存 Run 409 分支。
- 领取拒绝明确返回 410，不创建 Operation，不查询/领取 execution_jobs，也无 Gateway/Worker 调用。
- 删除 helper 只按 workspace_id+id 查 Run。缺失及跨 Workspace 为 404，既存 Run 全部 409，
  包括终态、活动与结果待核对；正文明确未删除或取消，没有 204/成功伪装。
- 没有新增软删除字段、级联、业务 UPDATE/DELETE、生产配置或公开入口启用，符合获批过渡范围。

## Standards 轴：规范与安全

- 两个拒绝分支均使用原 action（execution_job.process_next / run.delete）、denied outcome，
  审计参数来自已鉴权上下文和当前目标；元数据分别为固定退役原因，或未迁移原因及已读 Run 状态。
- ApiError 的第四参数 commitOnError=true，确实由 createTransactionBackend 保存拒绝审计。
  分支在任何业务变更之前，提交内容仅为拒绝事实和共享 Session 活动时间；请求预算本来就在事务外。
- 审计写入若失败会进入一般异常回滚并返回脱敏 503，不会伪装为已记录的拒绝。
- runDeletionConflict 没有锁或修改业务记录，既不需要假设逻辑引用为 FK，也不声称能隔离并发删除。
  审计 status 表示拒绝时观察值，不保证后续 Worker 无状态变化；这个边界不影响“此次没删”的事实。
- 类型复用现有 SqlClient、RuntimeInput、ApiError，没有引入新依赖或 Secret 访问。

## 独立验证

重新运行 `ARC_RUNTIME_TEST_PORT=55433 node --experimental-transform-types scripts/runtime-legacy-control.test.mjs`：
3 passed / 0 failed，1.529 秒（包含导入 identity fixture 时注册的既有 runtime-http 回归）。
测试覆盖未登录、CSRF、Origin、viewer 权限、缺失及非成员 Workspace；对完整 Run、Operation、
uncertain effect、checkpoint 前后比较相等，且 denied 审计实际持久化。
随机 schema 由测试 helper finally 删除并检查，不操作生产或停止共享容器。
实现者记录的 Red、lint/build 不在本审查重跑；主线程完成最终整合门禁。

建议（非当前阻断）：以后扩展测试时增加“同时属于两个 Workspace，试删另一空间 Run”的案例，
以及 audit_events 人工约束失败的回滚测试。当前查询本身已经有双条件范围，事务框架也明确回滚。

## 附录：Tool test-invocations 的最小完整 202 切片（评估，未实现）

### 已查事实

- 旧 main.py:2851 POST 为 agent.write，同 Workspace HTTP/MCP Tool，正文 `parameters` object，
  同步执行后返回 201 ToolSkillInvocation，并写 tool_skill_asset.test_invoke 审计。
- 旧 tool_runtime.py HTTP POST 直接发送 parameters 对象；GET 将其中各字段放 query。
  MCP 默认 DisabledMcpToolGateway，是受控失败而不是真实 MCP 执行能力。
- 当前 agent-tools.ts 的 invoke 只接收 string input；POST 发送 `{input}`，GET 仅 input 参数。
  它的冻结数据绑定 Agent/Run/NodeRun，所以不能用虚构 Agent/Run 套出独立测试调用。
- Runtime service 尚无独立 Tool 测试 kind；AssetLibrary 页面期望同步 Invocation，收到后立即提示
  “测试调用完成”。直接改后端返回 Operation 会制造错误完成感。

### 最小需同批交付的范围

1. 先确认 201 Invocation→202 Operation 的显式契约差异（含 operationId/invocationId 查询关联）。
   在 Session/CSRF/Workspace/agent.write 与参数校验后，事务冻结资产配置、输入、唯一 invocationId，
   创建待执行记录、Operation、事件和 accepted 审计；HTTP 不调用网络。
2. 新增一个明确独立执行器（需批准 Operation kind 扩展），复用现有 worker 租约/effect/ledger，
   不复用虚构 Agent/Run。固定 Workspace+host allowlist，当前资产 active 和历史安全配置检查，
   明確停用发生在排队/发送之间时是拒绝还是固定授权；POST/GET 保留 parameters 旧语义。
3. 提取可共享 HTTP transport 的安全边界而不改变 Agent 输入契约：HTTPS/443、禁止 redirect、
   不接收任意 header/secret、总时限与响应字节上限、幂等键。未发出失败与结果不确定分开，
   不能把 5xx、超时、响应截断或 Worker 中断直接重发；effect 状态需关联 Invocation 可查询。
4. Operation/Invocation 终态一致记录：成功、已知失败、needs_reconciliation、取消；重复 AWL 不重发。
   既有 Operation 查询/control 使用 run.read/run.execute，而创建要求 agent.write，必须确认后续
   查询、requeue、reconcile 的权限是否可沿用，不能无意扩大 operator 的工具执行权。
5. API 类型、AssetLibrary、迁移能力门禁与测试同批更新：202 只显示“已受理”，可刷新/查询当前
   Operation；只有持久终态才显示结果。页面切 Workspace/卸载后不误写旧结果；MCP 保持明确未配置，
   Skill/Manual 不应借此次迁移新增执行能力。

### 必须验证的失败路径

未登录/CSRF/越权/跨空间、额外字段/非 object/超限 parameters、非HTTP/MCP资产和停用、无Host绑定、
201→202真实UI契约、并发重复提交同键及同键异载荷、重复AWL、发送前拒绝、发送后超时/响应超限/中断、
未知结果无自动重发、取消后不新发、效果已完成但Invocation回写前中断恢复、审计失败整笔回滚。

生产入口仍关闭时，本地合成 transport 能验证上述控制面，但不能替代真实云端投递和业务验收。
本附录没有新增 Operation kind、路由、数据库对象、前端变更或外部调用。
