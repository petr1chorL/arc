# Provider运行状态冲突修复回执

2026-10-27。用户首个Agent运行f6d9daac-5c66-4684-859f-9ab5e0df6190失败。发布版本绑定Provider正确，用户只读查询确认Provider仍为创建默认draft。部署仍为6ae053068fe2ca20dd4c335a。

## 根因与边界

创建默认draft且原生配置检查不改状态；发布及旧Python只拒绝disabled，而原生Agent/评估四处查询仅接受active。该状态冲突发生在模型网关之前，不要求更换Key或手工修改生产数据；Key实际可用性仍待修复后真实调用验证。
事件accepted→claimed→tool.inputs_frozen→failed与该路径吻合，后台已领取并完成工具输入冻结，不是仅排队未消费。
既有测试人工预置active掩盖了真实创建状态。失败时通用文案与durationMs=0不代表运行总耗时为0，也不是供应商账单证明。

## 新验证

- 内存SQLite执行实际Judge查询：draft先明确抛出NotSentError（RED），修复后7项通过；覆盖draft/ready/active，以及disabled、跨空间、缺失、绑定变化拒绝。
- 原预算9项通过；测试运行器边界1项通过；lint、类型检查及build通过。
- Agent/独立评估/Workflow评估/运行浏览器四处PG fixture改为draft，由新CI验证。SQLite不是PG或云端模型验收。
- Spec与Standards独立审查均未发现严重问题；Workspace/id/FOR SHARE/固定绑定哈希及预算未改变。
- 仅单独提交Provider修复和证据；工作区最终路由切流准备不包含在本次发布。

## 待完成

新精确提交CI、云端发布、一次受预算保护的真实Agent复验及后续闭环。没有自动重放线上失败Run，未关闭Zeabur。
