# 原生评估读取正式发布量规快照

## 根因与范围

用户工作流8ccfc63c-bd33-4f7d-8748-b8246d405ae7已完成Agent与人工修改批准，传给评估的内容正确，但评估立即失败。
正式量规发布存储Python兼容snake_case，API版本展示会转换camelCase；运行时直接读取DB快照却期待camelCase。
既有运行PG测试手写camelCase快照掩盖了真实发布链路。该缺陷可使judgeType/judgeModel缺失并在网关前失败；用户记录尚未给出供应商账单，不以0Token判断费用。

## 第一性原理与计划

固定版本必须可执行且不可被静默改写；应统一读取边界而非篡改历史或要求用户重建。
1. scripts/runtime-rubric-snapshot.test.mjs先调用现有pinnedRubric读取发布格式，明确RED。
2. 新runtime-closure/rubric-snapshot.ts兼容四个snake/camel字段、冲突拒绝、不变更输入，严格区分LLM与deterministic，不用缺失类型自动降级。
3. evaluation.ts在固定版本读取和执行入口规范化，保留版本id/Workspace/Provider/绑定哈希校验。
4. 新runtime-rubric-publication-postgres.mjs通过真实资产创建/量规发布来执行独立及Workflow评估，以合成网关证明持久结果；不是手写快照或真实模型费用测试。
5. 纯测试、旧Provider与预算回归、lint/build、双轴审查、真实PG CI和精确云部署后，只恢复现有失败节点进行验收；不重跑已完成Agent/人审。

## 对抗式检查

不改历史快照，不接受冲突字段或隐式deterministic降级，不跳过评分完整性或阈值；不改变模型绑定、1元预算和未知结果核对规则。没有证据前不宣称全流程通过，不发布旧代理切流准备。
