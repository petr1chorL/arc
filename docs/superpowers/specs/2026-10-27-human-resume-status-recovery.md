# 人工审核恢复成功后的终态修复

用户原目标：完成人审恢复新业务验收。本切片处理已决定任务后续恢复失败、同一Operation重投成功后仍显示恢复失败的问题；不新增生产数据直改或外部调用。

## 第一性原理与边界

审核决定已持久化，后续计算失败不撤销该决定。恢复成功应同步业务投影，不应要求重复决定、重写产出物或重跑成功模型副作用。仅human.resume成功且HumanTask当前为恢复失败时修复；其余状态不变。

## 计划

1. `runtime/human-resume-status.ts`：纯状态选择器，核对workspace/task/run/resume/decision/target身份及持久决策聚合结果。reject→已驳回，return_for_rerun→已退回；approve中有modify_and_approve→修改后通过，否则已通过。
2. `scripts/runtime-human-resume-status.test.mjs`：先RED覆盖状态、关联、聚合、非成功/非恢复失败与缺失/外国决定；再GREEN。
3. `runtime/service.ts`：在既有generation/status fenced结算事务内恢复投影；锁住关联Task与Resume、读取持久decisions，条件更新只影响恢复失败；保留取消Run和取消父Operation禁止复活。
4. `scripts/runtime-human-resume-recovery-postgres.mjs`：真实mutateHuman修改批准→人工后评估前置失败→同一Operation重投→同一Run完成，检查Task、决定、修改产出版本、初始化事件及重复消费。追加普通批准和取消不复活。
5. verifier纳入两新程序，定向纯测试/lint/typecheck先行；真实PG由CI执行，不声称本机通过。

## 对抗式审查

不以op.input.action alone决定终态；用真实持久决定及原固定review_policy/participants核对结果。关联不一致不恢复Task；不改变取消/代次保护，不添加外发或修改评价模型。成功模型effect缓存、已有artifact版本与decision行只读。

## 独立复审修订

- 人审转组可替换participant_snapshot而保留历史票。审批人数由当前参与者票决定，但修改标记按全部同Workspace/Task合法持久票决定，与human.ts一致。最终decision必须当前参与者；历史票不能独立授权恢复。
- 将锁序修复扩展到worker.ts：共享lockOperationRun供requireLease、initializeResume和成功/失败结算使用。human.resume固定own Operation围栏→Task→所有对应父workflow.run（ORDER BY id FOR UPDATE）→Run→Resume/Decision；workflow.resume省略Task。
- 不仅查询canceled父行，实际锁定waiting_review等父行，避免与controlOperation的父Operation→Run反向等待；外部effect前的持久意图事务同样采用此顺序，提交后才调用外部transport。
- 恢复关联每次围栏事务都校验，初始化标记已存在也不能跳过；无关联不进入业务回调。非关联操作保持既有mode，无网络或数据直改。
- 新增两个受控PG barrier：取消先持父行、lease等待父行后取消写Run；成功结算到达前暂停、取消持父行后callback等待父行，验证取消可取得Run且Task不恢复。只有CI真实PG通过后才声称这些并发场景通过。
