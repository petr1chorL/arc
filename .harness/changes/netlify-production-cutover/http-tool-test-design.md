# HTTP Tool独立测试202需求总结

Status: Tool 本地工程 ready-for-human，生产未启用；间歇全量测试卡死尚未确定根因。结果见 tool-test-verify.md。
设计：docs/superpowers/specs/2026-09-06-http-tool-test-operation-design.md。
计划：docs/superpowers/plans/2026-09-06-http-tool-test-operation.md。

使用harnessing做边界/异常/验收核查；已确认202/Operation与人工核对不重问用户。
主线程已判断四项推荐工程语义在现授权内，并完成相应实现与审查。

新增源码事实：旧HTTP parameters不是Agent{input}；enqueueOperation hash含actor且不能混随机Invocation ID；
原Invocation历史只接受succeeded/failed，所以pending/uncertain必须同步扩展；generic controls仅run.execute，
operator有此能力但没有agent.write，必须kind-aware防绕过；当前Tool deactivate可复用asset行锁定义意图边界。

最小方案需要独立tool.test kind、一张不可变Tool快照表、effect意图事务可选active守卫、严格参数transport、
Operation/Invocation过渡一致、权限与前端查询完整接线。不能简单加一条路由假装已完成迁移。
没有新状态机枚举：复用Operation状态，Invocation新增合法原生状态投影；不伪造Agent/Run。

推荐主线确认：停用拦新意图而非撤回在途；MCP固定未配置失败不增加执行；维持原生文本隐藏；
known-failed对应Operation failed。若要求原始输出恢复可见性，属于需额外明确的真实业务选择。
