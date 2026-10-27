# 正式发布量规快照读取修复

2026-10-27。用户工作流8ccfc63c-bd33-4f7d-8748-b8246d405ae7已完成真实Agent（75 Token）与人工修改批准；人工输出已作为评估输入，评估节点失败。未自动恢复或重新运行。

## 根因与复现

真实publisher保存judge_type/judge_model/model_provider_id/pass_score，版本HTTP展示转camelCase；执行器却直接按camelCase读取存储。原运行测试手工插入camel快照，未覆盖真实发布边界。
纯测试调用pinnedRubric读取实际存储形状先明确失败（ApiError评分类型无效），规范化后通过。此缺陷发生在构造Judge请求前；不以UI的0Token或$0推断实际账单。

## 修复与本地证据

- 新只读规范化边界兼容snake/camel，拒绝冲突、未知/缺失Judge类型、非法阈值、LLM缺失模型/Provider；不默认降级，不改历史。
- pinnedRubric、评估执行、Workflow固定版本读取均覆盖；保留Workspace/固定版本/Provider/hash及预算。
- 新快照5项、Provider7项、预算9项、runner边界1项通过；lint、类型与build通过。
- Spec与Standards独立审查均无剩余严重项。PG fixture在提交前修正真实HTTP的providerType枚举，并明确断言低于阈值仍failed。
- 新真实发布PG程序：真实身份/Provider创建、量规创建/发布、独立及Workflow评估落库、重放不重复调用、历史快照不改；当前未在本机跑PG，等CI。
- 仅提交本切片，旧代理切流补丁仍不提交/发布。

## 尚未完成

精确CI、部署、原失败节点恢复后的真实模型评估和剩余调度/停用验收。预算上限仍为人民币1元，Zeabur仍保留。
