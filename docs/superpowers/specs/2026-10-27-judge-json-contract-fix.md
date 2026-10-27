# 保留LLM Judge既有JSON输出要求

## 已证实的问题与边界

JudgeRequest原本声明并构造responseFormat=json_object，但Judge→ModelRequest→HTTP及验收正文重建均未保留。合成fetch捕获实际正文确认缺失；这不是本次已确认的snake快照失败根因，未声称看到过本次供应商返回Markdown。
[千问官方结构化输出](https://platform.qianwenai.com/docs/developer-guides/text-generation/structured-output)确认Qwen3.8-Flash支持JSON Object，需response_format且提示词含JSON（现有Judge提示词已满足）。JSON模式不保证评分语义/维度结构，仍须严格服务端校验。

## 第一性原理与计划

目标是让机器消费的已有结构化契约真正到达模型，不依赖自动付费重试或剥离任意包装符。
1. 新runtime-judge-json.test.mjs组合真实Judge adapter、gateway、预算transport及合成fetch，先RED确认wire缺字段。
2. runtime/gateway.ts新增可选exact json_object格式验证并输出response_format；普通Agent请求保持原格式。
3. runtime-closure/evaluation.ts透传现有参数；native/acceptance-budget.ts只允许exact json_object且在受限正文中保留。
4. 不改变端点、模型、Workspace、Secret Ref、8KiB输入、关闭思考、512输出上限、20次持久预留或不退款规则；拒绝json_schema/额外字段。
5. 验证普通请求、非法格式外发前拒绝、原始预算入口无法旁路、无效JSON内容仍失败；继续现有Provider/预算/网关回归与完整CI。

## 已有证据及未完成

RED明确缺失response_format；GREEN新5项、旧预算9项、旧gateway4项通过，lint/build通过。
没有真实模型请求，不改历史effect缓存、不创建新接口、不扩大权限。与人审恢复收尾合并审查后另提交，不夹带旧代理切流准备。
