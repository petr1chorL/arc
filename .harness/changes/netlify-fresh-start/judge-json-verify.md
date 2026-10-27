# Judge JSON传递与恢复收尾：本地验证

日期2026-10-27。原量规快照修复0c61e64的完整CI40488801430已成功；本次新增代码仍需新SHA独立CI。

## JSON契约

真实Judge adapter→gateway→预算transport→合成fetch首次RED捕获response_format缺失；完整透传后5项GREEN。
精确允许单键json_object，不接受schema/额外字段；普通Agent不带此字段、较低输出上限不变。
非法格式在预留/外呼前拒绝；原始预算transport不能旁路；JSON包装内容仍严格解析失败，不写成功评估、不自动付费重试。
旧预算9项、旧网关4项通过，输入8KiB、512输出、20次持久预留及固定绑定均未改变。
官方协议依据见docs/superpowers/specs/2026-10-27-judge-json-contract-fix.md；这不是本次snake快照错误的供应商响应证据。

## 人审恢复状态与围栏

恢复状态7项纯测试通过，新增转组历史先RED再GREEN；最终决定必须现参与者，历史修改票保留但不计当前人数。
统一Task/父Operation/Run锁序，保留自身Operation代次/租约围栏与父取消保护；完整引用错误不进入业务回调，锁不跨外部fetch。
真实PG恢复、两个并发取消barrier与非法引用仍待CI。旧Tool/取消/发布评估的合成fixture补完整Run/关联，不能靠错误fixture假通过。
Spec和Standards复审均无剩余阻断；runner边界、lint、typecheck通过，主线程完整build通过。

## 发布与生产边界

不直接改生产Task，不自动恢复失败Run，不重复决定或重写已审核产出物；待精确CI和部署后由用户恢复原评估节点。
本切片不包含工作区未提交的Zeabur路由切流准备；未停用旧服务，未修改凭证，未新增真实模型调用。
