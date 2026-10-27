# 人审恢复成功终态修复：候选回执

日期：2026-10-27。仅本地候选，不修改生产数据、不调用真实模型、不提交推送部署。

## 根因与改动

人审决定已把Task设为终态，后续human.resume失败会改成恢复失败；原成功结算只同步resume_requests，未恢复Task。现在在原Operation generation/status围栏结算事务内，锁定Task、检查父Operation/Run未取消，再核对真实resume/decision链并恢复失败投影。

- `runtime/human-resume-status.ts`：纯状态选择器，全部身份关联一致且持久投票聚合与resume.action一致才返回终态；approve聚合任何modify_and_approve为修改后通过；其他终态精确保留。
- `runtime/service.ts`：仅human.resume成功且Task当前恢复失败时更新；同一事务含Resume成功与Task恢复。Task先于Run锁定，与人工决定写入锁序一致；保留代次/status围栏，并拒绝取消父Operation。
- 新纯测试与新PG程序加入原生verifier；不改变决定提交、修改产出物、模型调用或旧检查点恢复逻辑。

## 验证

- RED：新纯测试首次因恢复状态helper尚不存在而失败；新增后GREEN。
- 5项纯测试通过：包含多票修改批准、普通/驳回/退回、状态限制、完整关联、缺失/外国/非参与/重复/不足投票。
- PostgreSQL程序语法检查通过；真实PG未在本机运行，等待CI，不把静态检查称作实际恢复成功。
- PG覆盖真实mutateHuman修改批准/普通批准，人工后注入评估前置失败（零effect发送），同一Operation requeue后同一Run完成；Task对应终态、一个决定、原审核产出版本数量不变、初始化事件一次、模型合成effect一次；重复消费不再执行。
- PG另覆盖重投后取消父Run，再消费不得复活Run或Task、不得调用评估effect。
- `npm run typecheck:netlify`、`node --check scripts/runtime-human-resume-recovery-postgres.mjs`、`git diff --check`通过。最终lint与runner边界结果见本轮命令记录。

## 未完成/边界

CI真实PostgreSQL、独立复审、新SHA发布与同一个生产失败Operation恢复验收仍待主线程执行。该补丁不对生产Task做直接修正，也不把其他kind/失败/取消/等待中的Operation投影改成成功。

## 复审修订（同日）

- 转组历史票回归先RED（null而不是修改后通过），修复后GREEN；all/threshold均保留历史修改标记，只计当前参与者批准，最终decision必须当前参与者。
- 锁序纯回归先RED（原requireLease只有own→Run），修复后GREEN（human为own→Task→parent→Run→resume→decision；workflow.resume为own→parent→Run）。
- worker.ts新增共享lockOperationRun，每次lease/初始化/结算都真正锁住所有父workflow.run行，FOR UPDATE避免后续锁升级；Run前取得父行，外发前提交事务。恢复Task/Resume/Decision/Artifact关联错误不进入业务工作。
- 新PG barrier覆盖取消与lease、取消与最终结算并发；另有七类伪造恢复关联前置拒绝。仅语法检查，未本机执行，仍待CI。
- 最新7项纯测试、Node语法、typecheck、lint通过；未修改JSON/gateway/cutover代码。
