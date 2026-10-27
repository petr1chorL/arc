# Provider 创建与运行状态契约修复

## 范围与根因

线上首个Agent验收失败，事件为accepted→claimed→tool.inputs_frozen→failed。用户只读证据确认固定版本绑定有效，Provider状态draft。
原生资产创建保存draft，配置检查不改变状态，发布只拒绝disabled；但Agent及评估运行查询仅接受active，因此合法新资产在发送模型前被判不存在。
旧Python运行同样只拒绝disabled。不能要求用户手工改生产表或换Key来绕过此实现不一致。

## 第一性原理与实施计划

目标是让已获服务器绑定授权的非停用Provider可执行，并持续拒绝停用/跨Workspace/缺失引用。
1. scripts/runtime-provider-state.test.mjs用内存SQLite执行真实Judge查询，先复现draft错误拒绝；没有模型网络调用，不替代真实PG集成。
2. runtime/workflow.ts和runtime-closure/evaluation.ts的四处Provider选择统一排除disabled，保留原Workspace/id条件和FOR SHARE锁，不改变其他资产状态规则。
3. 已有真实PG运行fixture改用实际创建默认draft，新增纯测试进入verify-runtime-local.mjs；验证draft/ready/active、disabled、跨空间、缺失、配置排队后改变。
4. 定向测试、lint/build、双轴审查与精确CI成功后单独部署，不能夹带未验收的路由切流准备。

## 对抗式检查

状态可用不等于允许任意外呼：固定绑定、Secret Ref、参数校验、持久预算仍由原网关强制执行。不改生产数据，不自动重放失败Run，不把本地模拟当线上修复或计费证明。
