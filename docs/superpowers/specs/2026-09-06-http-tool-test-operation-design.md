# 独立 HTTP Tool 测试调用：202 Operation 设计

状态：主线程已按现有用户授权确认工程语义，进入实施；本段确认时尚未新增操作种类、迁移文件或运行实现。

主线程确认（2026-09-06）：采用本文四项推荐。停用拦新意图、不撤回在途；MCP固定未配置失败、
不实现真实MCP；保持既有原生正文隐藏、不扩张可见性；known-failed对应Operation failed。
这是已授权原生迁移及202契约的实现选择，不授权真实外发、付费、源数据处置或生产开关。
实现时确认：GET JSON 数值按语义规范化，不保留 1.0/1 等数字词法差异；其他参数类型与已安装
Python/httpx 做离线对照。空/空白文本输出（包括 JSON 空字符串）为待核对，不能报成功。
页面同一未确认提交只在当前挂载期间保留 key；已受理任务可按持久 ID/历史恢复查询，
刷新后再次测试为新提交。页面有提示，不持久保存原始参数、不自动重放未知受理请求。
来源：原生迁移 PRD、用户已接受长操作202+Operation及未知结果人工核对、07生产切流缺口，
以及 runtime-legacy-review.md 附录。当前切片不是给 Agent 测试运行增添一个假 Tool。

## 第一性原理与最小方案

管理员需要验证一个已登记 Tool 的调用结果。必须存在：真实资产、固定请求、操作者、可查询受理记录、
唯一外部动作意图、实际投递结果和不可确认状态；不需要 Agent、Workflow、Run 或 NodeRun。

推荐独立 `tool.test` Operation，通过既有 AWL/worker/effect 接缝消费，Invocation 继续使用现有表，
agent_id/run_id/node_run_id 均NULL、agent_version为空。同步201会继续占用HTTP请求且弱化中断恢复；
伪造Agent/Run会污染领域、权限、运行统计和清理语义。两者均不采用。

### 已确认代码约束

- 旧 main.py 的测试接口要求agent.write，正文只允许parameters对象；HTTP POST直接发送该对象，
  GET逐键展开query。旧MCP默认未配置，不能称为真实MCP执行。
- 当前 runtime/agent-tools.ts 私有invoke只接收string并发送{input}，固定数据依赖Agent/Run/NodeRun；
  不可以拿它直接替代独立Tool测试的parameters协议。
- enqueueOperation按包含actorId的input摘要和Workspace+kind+key去重；把随机invocationId放入input
  会使相同请求重试变成409。把可变资产配置直接放input也会使配置更新后的同键请求改变身份。
- 既有Operation控制默认run.execute(operator)，创建测试则agent.write(builder)。不能让operator
  通过通用requeue执行自己无权创建的Tool测试。builder本来继承run.execute，不需要改角色矩阵。
- reference-assets/history-postgres目前只接受succeeded/failed Invocation并隐藏历史文本。
  新增pending/needs_reconciliation记录会让整个资产历史409，必须同步扩展合法原生状态投影。

## API 与持久对象

`POST /api/workspaces/{workspace}/asset-library/{asset}/test-invocations`：

- 继承真实Session、Origin、CSRF、Workspace和agent.write；只接受parameters object（默认{}），
  拒绝额外字段，沿用共享1MiB正文上限，并限制序列化parameters至64KiB、嵌套深度32，避免摘要递归无界。
- 前端每次用户明确提交生成Idempotency-Key；重试同一次提交保留同键。不得自动重放写请求。
- 202返回现有projectOperation字段，加invocationId；statusUrl仍是同Workspace操作查询。
  result未完成时不能伪装成旧Invocation。重复同键同请求返回原Operation/Invocation，异载荷或actor409。
- 事务内先enqueueOperation(input仅{assetId,parameters},targetId=assetId)，取得op.id后按op.id查快照。
  已有快照代表同次请求已受理，返回原状态而不读取后来变动的资产重新冻结；没有则校验资产并冻结。
  所有校验/审计失败回滚Operation/outbox/Invocation/快照，因此不存在可被consumer看到的半受理记录。
- Invocation使用`id=op.id`作为独立UUID标识，effect_operation_id=op.id，避免随机ID进入请求摘要。
  两者语义不同但使用同一个生成UUID做一对一关联，不创建伪造业务关联。
- 新增一张前向表`runtime_tool_test_snapshots`：operation_id主键、workspace_id、asset_id、
  asset_snapshot JSONB（name/type/adapter/config及提交时status）、created_at；输入留在Operation.input。
  快照在受理事务只插入一次、只读不更新；适用全量迁移对账。新建表不改历史migration。
- 受理审计action沿用tool_skill_asset.test_invoke，outcome仍success，metadata阶段accepted以及ID。
  这里success只表示受理事务成功，页面与文档均不得把它当执行完成；业务结果由Operation事件记录。
  资产审计投影必须对受理记录显式显示phase=accepted与operationId，不沿用旧“测试完成”标签。
  不新建asset历史不接受的audit outcome=accepted。

## 权限：共享操作接口也必须守住边界

不修改角色矩阵，不授予或撤销全局run.execute。

| 入口 | tool.test所需能力 | 实现边界 |
|---|---|---|
| 创建测试 | agent.write | 沿用旧接口 |
| Invocation历史、Operation查询 | asset.read（现viewer也有run.read） | 同Workspace，正文保持迁移脱敏策略 |
| Operation取消、重投 | agent.write | 通用runtime.postgres读到kind后补检查，不能只靠run.execute |
| 待核对决定 | workspace.manage且agent.write | 保持高权限+理由；retry必须确认重复风险 |
| execution-jobs别名详情/控制 | 对tool.test返回404 | jobs只用于运行队列，不能从别名绕过新kind控制规则 |

Operation列表可显示经过白名单投影的测试状态/ID；不暴露parameters、内部快照、transport参数。
OperationCenter/Progress须按返回kind和当前agent.write决定按钮，不能复用所有任务统一canExecute。
后端检查是最终边界，UI隐藏按钮不能代替后端校验。

## 发送前停用与不可重放

建议语义：**停用阻止之后创建的新发送意图，不保证撤回先前已授权/在途的调用**。

1. 提交时拒绝disabled资产；config变动不改变已受理快照，受理后再提交新键才使用新config。
2. Worker进入新effect意图事务时，锁Operation代次后对当前asset行FOR SHARE，确认同Workspace、仍active，
   然后写started意图；资产deactivate使用FOR UPDATE，因此两者有明确先后顺序。
3. 需要给RuntimeContext.effect增加可选beforeIntent(client)守卫：在确定不是缓存成功且写新started之前执行，
   和现有租约/意图同事务。既有调用不提供守卫不变。不能在executor里先查active、另开事务再记意图，
   那样有停用竞态。缓存成功结果不再执行active守卫，因为它不产生新外部动作。
4. 意图先于停用提交的调用可能继续返回；保留其真实结果，不改成“未发送”。停用后新retry仍重新检查。
   未知结果仍由人工核对，不因资产停用而清除证据。
5. 新提交判断非HTTP Tool为422。MCP测试不增加真实transport：保持明确“未配置，未执行”行为；
   是否同202受理并落known-failed Invocation见文末范围选择，不能默默称MCP已迁移。

## 执行与状态

Operation不新增状态值，只新增已确认kind tool.test。Invocation扩展状态是实际受理/执行的投影：

| Operation | Invocation | 外部语义 |
|---|---|---|
| queued | pending | 已受理，不代表发送 |
| running | pending或running投影 | consumer已领取，不表示外部成功 |
| succeeded | succeeded | transport返回已确认成功 |
| failed/dead_letter | failed | 已确认拒绝/未完成且无未知effect；固定失败码 |
| canceled | canceled | 取消未开始意图，不声称撤回已发送动作 |
| needs_reconciliation | needs_reconciliation | started/uncertain外部结果，不可自动重发 |

明确HTTP4xx/拒绝/停用/MCP未配置成为可查询failed Invocation，Operation以failed终态结束，
不将“执行器返回了失败结果”映射为Operation succeeded；实现前由主线程确认这个映射。
通过OperationTransition新增tool.test分支，在worker最终/接管判断和HTTP control同事务同步Invocation，
不向synchronizeRun传入伪runId。不能只在executor最后写Invocation，否则取消/租约超时会遗留pending。

外部调用使用固定effectKey及invocationId幂等头；请求hash包含固定URL/method/parameters。
重复AWL、已succeeded effect仅重建/投影持久结果，不发送；started/uncertain直接待核对。
发送前NotSentError才可安全重试；传输超时、5xx、redirect、响应超限/解析失败或进程中断都不能推定未发生。
reconcile retry需要人工重复风险确认，并推进effect attempt；fail保留未知证据及决定，不伪造成功receipt。
已完成的HTTP4xx receipt属于已确认业务失败，普通requeue不删除缓存也不产生新外部请求；若要重新
验证服务，用户明确再次“测试调用”创建新键。不能为让requeue看起来有效而擦除已完成effect。

## HTTP transport最小复用

抽取`runtime/http-tool-transport.ts`：输入config、parameters object、Workspace+host白名单、invocationId、注入fetch。
Agent调用方继续显式传{input}，独立测试传原parameters。保持HTTPS443、禁止IP和redirect、固定允许Host，
10s覆盖fetch与stream读取的总时限、64KiB响应上限、固定HTTP诊断与1000字符摘要。未知错误不回显原异常。
GET使用与Python/httpx一致的逐键参数编码（需对比bool/null/list/nested值），不能把整个对象转成input。
不支持新headers/secretRef/认证配置，不扩大外发host授权，不实现MCP/Skill/Package运行器。

## 查询与前端

- assetLibrary.testToolSkillAsset改用readOperationResponse和operationRequestHeaders，兼容legacy201与native202。
- 202仅提示“测试已受理”，记住operationId/invocationId；复用OperationCenter持久ID/刷新查询，不能立即显示完成。
- 原生Invocation历史必须接受由effect_operation_id关联到本Workspace原生账本的pending/canceled/
  needs_reconciliation；不能无条件把任意历史脏status放行。安全投影与旧文本隐藏策略保持。
- 返回测试业务错误采用固定errorCode/文案，原始配置/参数/外部内容不得通过Operation.result绕过历史隐藏。
- 当前迁移统一隐藏历史输出；本切片推荐只显示状态、耗时、固定诊断及关联，不顺便解密/解除历史隐藏。
  若“测试调用完整”必须展示原始返回内容，需要主线程明确是否授权新的可见性契约，不能默认扩大。
- refresh/Workspace切换/卸载race沿现有请求边界；操作恢复不能跟随任意服务返回URL。

## 主线程已确认的边界选择

1. 推荐采用上述停用的“新意图”时点；不是严格物理发送时点的撤销保证，后者无法靠短事务实现。
2. 推荐HTTP为本次真实执行范围；MCP通过202记录固定未配置失败，保持旧默认无网关结果，不新增MCP。
3. 推荐维持原生文本隐藏，只展示可确认状态/耗时/诊断。若要求查看原始输出，需另定安全可见性范围。
4. 明确known-failed业务结果映射Operation failed，统一UI无错误完成感。

以上四项已由主线程在本文开头确认并实现；不扩张生产授权。第3保持现有安全可见性契约，
若后续需要原始返回可见，仍须另行明确，不能擅自放开。
