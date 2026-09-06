# 05/06 独立 Spec 轴审查

日期：2026-09-06。审查范围：已确认 05/06 设计、原 Python 合同、原生 runtime / runtime-closure / runtime-delivery、Operation 前端接缝及隔离验证脚本。

使用 `expert-reviewer-front` 的独立 Spec 轴；不套用其中 Vue 模板假设。本文只记录需求匹配与验证证据，不替代独立 Standards 轴、主线程全量门禁或浏览器回执。

## 当前结论

**Spec 轴当前剩余已证实严重问题：0；可以进入最终集成验收。** 取消后人审复活、整改复测终态误判、评分节点输出合同、舍入差异、Operation 终态分离提交恢复窗口，以及子 Operation 对 Run 取消的 fencing 均有独立最新定向复验。此结论不是 05/06 全部完成声明：主线程仍需汇总完整门禁、浏览器与 AC/文档回执。

生产函数休眠、未发布、未搬迁真实数据不是本次缺陷：第 5/6 项明确在本轮范围外。不得将纯合成模型返回、SDK 唤醒接缝或站内通知称为真实付费模型质量验收、真实外部通知或云端运行验收。

## 已证实的问题与修复复验

### S1：取消等待审核的运行仍可被决定/恢复复活（严重，定向复验通过）

原始位置：`runtime/controls.ts` 的 Run 状态更新、`runtime-closure/human.ts` 的决定入口、`runtime/service.ts` 的 `initializeResume` 与 `runtime/workflow.ts` 的执行入口。

独立 PG 复现：在 `runtime-closure-workflow-postgres.mjs` 的同一合成闭环等待审核后取消原 Operation，再提交合法 `modify_and_approve` 并消费恢复 Operation。观察到取消后 Run=`已取消`，恢复后 Run=`已完成`，原 Operation 仍为 `canceled`。这不是假设性的竞态。

实施者随后补充 Run 取消守卫及两种时序测试：先取消再决定、先决定排队恢复再取消。独立重新运行该 PG 脚本退出 0，两种时序均保持 Run 取消终态。Agent 直接运行取消时遗漏 Run 更新的问题也已修复；独立执行 `runtime-ledger.test.mjs` 的新增 Agent 取消断言通过。

### S2：已失败或取消的复测被当作持续运行，整改无恢复出口（严重，定向复验通过）

位置：`runtime-closure/remediation.ts` 的 `detail`、更新守卫与复测入口；`runtime-closure/queries.ts` 的 `regression.list`。

独立 PG 复现：将已创建复测 Operation 设为 `canceled` 后，详情的实际复测状态为 canceled，但摘要为 `pending / 复测中`；更新整改返回 409；再次复测仍返回原 canceled Operation。批次列表此前也直接投影 `regression_runs`，不能反映 Operation 的 failed/needs_reconciliation。

修复后区分真正运行中、结果待核对与已确认失败/取消；待核对仍不能靠创建新复测绕过，已确认终态可显式创建新尝试；列表使用与详情相同的状态投影。独立执行 `runtime-closure-evaluation-postgres.mjs` 退出 0，包含新增终态恢复、待核对禁止绕过和列表状态断言。

### S3：Evaluation 节点透传原文，破坏旧结构化输出和评分对象关联（严重，定向复验通过）

旧合同：`apps/api/app/execution.py` 的 `execute_evaluation` 输出含 `evaluationRecordId`、`templateId`、`templateVersion`、Provider、`totalScore`、`passed`、`overallReason`、`dimensions` 的 JSON；被评对象为上游 NodeRun。

初版 `runtime-closure/evaluation.ts` 的 `createWorkflowEvaluator` 返回 `content: args.artifactText`，运行器还把当前评估节点作为 subjectId；因此已发布工作流下游的 `$.totalScore` / `$.passed` 无法继续按原合同取值。

现已恢复结构化节点输出及上游 subject 关联。独立执行 `runtime-closure-workflow-postgres.mjs` 退出 0，实际 PG 产出版本 JSON 的 totalScore/passed 与人工审核链通过；原产出版本保持不变。

### S4：评分半整数舍入使相同证据跨迁移翻转门禁（严重，定向复验通过）

位置：`runtime-closure/policy.ts` 的 `normalizeJudgeResult`；旧 `apps/api/app/evaluation_service.py:533`。

独立直接执行：两个权重 50% 的维度分别 82、83 分，passScore=83。初版 JS `Math.round` 得 83/passed；旧 Python `round` 得 82/failed。已补 ties-to-even，独立执行 `runtime-closure.test.mjs` 退出 0，边界断言返回 82。

### S5：Operation 终态提交后业务同步中断，重复事件无法修复 Run（严重，定向复验通过）

位置：`netlify/functions/_shared/runtime/service.ts:91` 先完成 `executeOperation` 再单独调用 `synchronizeRun`；`worker.ts:10` 对终态返回 null；`worker.ts:16`、`:21` 的 claim 阶段自身终态分支也返回 null。

独立 PG 注入：评分节点抛已确认普通失败，在 `synchronizeRun` 第一个查询前注入连接故障。结果 Operation 已持久化 `failed`，Run 仍 `运行中` 且 `completed_at=null`；再次用同 ID 调用 `processRuntimeOperation` 返回 null，Run 仍运行中。schema 已清理，无网络模型调用。

影响：页面与调度重叠判断可永久卡住；这违反短函数中断后恢复和同一业务链状态可追踪 AC。必须将终态同步纳入同事务，或持久化可重试的同步意图并确保终态重复消费/修复扫描实际覆盖。还必须覆盖 claim 阶段租约过期且 effect 不确定、超过失败重试上限的终态，不只覆盖正常 execute 返回。

修复后 `executeOperation` 与 claim 阶段终态均在原事务调用 `onTransition`，service 的 Run/Node 同步作为该 callback。独立再次在真实 service 同步查询注入故障：Operation 终态回滚为 running；手动使合成租约到期后重放，Operation=failed，Run=失败且 completed_at 已落盘。`runtime-ledger.test.mjs` 新增终态事务/claim 阶段测试后独立 11/11 通过。

### S6：Observability 字段映射与现有页面合同不一致（严重，定向复验通过）

位置：`runtime-closure/queries.ts` 的 observability.run 节点投影及 overview.totals。

初版节点只提供 inputText/outputText，现有 `src/pages/Observability.tsx` 读取 input/output；overview 提供 runs/succeeded/failed，而页面类型读取 totalRuns/succeededRuns/failedRuns。已向实施者指出，当前源码已补别名。新增实际 HTTP 字段断言后，独立再次执行 PG 闭环查询脚本退出 0；完整页面/浏览器结果由主线程汇总，不能把路由 200 等同可视内容已经验收。

## 非严重建议与边界

- 通知批次取消后未发送行保持停止执行，列表按 Operation 显示 canceled，这是取消语义，不应自动释放回 pending 导致继续发送。若未来允许恢复，应明确区分已证实未发送、已有成功收据与未知结果；当前没有因此单独判定严重缺陷。
- 建议本轮把取消运行关联的仍活动 HumanTask 收束为显式取消终态，并停止 SLA 提醒；已有审核决定不可伪造或改写。当前执行层已阻断决定/子 Operation 复活取消的 Run，但保留活动任务状态会形成“仍待审核、提交却被拒绝”的展示摩擦。主线程可用取消事务、审核终态类型及相称测试做最小修正；不得抹去在途外部调用待核对证据。
- `change.md` 通过已确认设计引用 AC 是可追踪的，但仍需任务结束前逐项填写最新证据与状态，不能用本审查替代完成定义。
- 本轮定位到的旧合同差异说明仅有路由存在或返回 200 不足以证明迁移等价；应保留节点输出、评分舍入、非终态和失败恢复的具体验证。

## 本审查已执行的验证

以下全部使用既有本地运行时、合成数据和独立随机 PG schema；schema 均由既有夹具关闭清理，没有生产数据库、凭证或真实模型/通知调用。

- 独立故障重放：取消等待审核后仍能恢复完成（修复前，已证实 RED）。
- 独立故障重放：取消复测被显示 pending、更新 409 且重复返回旧 canceled ID（修复前，已证实 RED）。
- 独立 Python/TS 评分舍入对照：82.5 在 83 门禁两侧分歧（修复前，已证实 RED）。
- 独立故障注入：Operation 终态与 Run 同步之间中断后重复事件不修复（已证实 RED）。
- `node --experimental-transform-types scripts/runtime-closure-workflow-postgres.mjs`：退出 0。
- `node --experimental-transform-types scripts/runtime-closure-evaluation-postgres.mjs`：退出 0。
- `node --experimental-transform-types scripts/runtime-closure.test.mjs`：退出 0。
- `node --experimental-transform-types scripts/runtime-closure-postgres.mjs`：退出 0。
- `node --experimental-transform-types scripts/runtime-ledger.test.mjs`：首次 10/10；S5 修复后 11/11；新增子 Operation Run 取消 fencing 后独立最新 **12/12**，退出 0。
- `node --experimental-transform-types scripts/runtime-workflow.test.mjs`：2/2，退出 0。
- S5 修复后的独立实际 service 故障重放：终态原子回滚、租约到期重放收束 Run，退出 0。
- 最新 `runtime-closure-workflow-postgres.mjs` 再次退出 0；新增实际下游 `$.totalScore` / `$.passed` 映射及被评上游 NodeRun 关联断言通过。

这些结果不是完整门禁通过声明。主线程仍需相关完整回归、浏览器和文档回执，不能把独立定向复验替代所有 AC 的完成证据。Spec 轴不再阻塞该最终验收；活动审核任务取消展示的建议已单独交给主线程，不把生产仍休眠列为缺陷。
