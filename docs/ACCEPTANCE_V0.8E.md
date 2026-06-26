# V0.8E 失败原因分类与排障建议验收说明

## 本版新增

V0.8E 在运行观测中心补上“失败原因分类”这一层，让异常运行不再只显示“失败 / 需介入”，而是进一步告诉用户属于哪类问题，以及下一步应该查什么。

## 已实现能力

- 后端观测概览与运行详情 API 返回：
  - `failureCategory`
  - `failureCategoryLabel`
  - `troubleshootingHint`
- 当前支持的分类：
  - `connector_auth_timeout`：连接器鉴权超时
  - `model_call_failed`：模型调用失败
  - `human_review_blocked`：等待人工审核
  - `resume_failed`：恢复执行失败
  - `quality_gate_failed`：质量门禁未通过
  - `unknown`：未知异常
  - `normal`：无异常
- 前端运行观测页支持按“失败原因”筛选，并把筛选状态同步到 URL query `failure`。
- 风险卡片、最近运行列表和运行详情会展示失败原因。
- 运行详情的处理建议区会显示排障建议。

## 验收路径

1. 打开 `http://127.0.0.1:4173/w/ai-capability-center/observability`。
2. 在“待排障运行”的筛选栏找到“失败原因”下拉框。
3. 选择“连接器鉴权超时”或“等待人工审核”，观察列表是否只保留对应类型运行。
4. 查看浏览器地址栏，确认出现类似 `failure=connector_auth_timeout` 的 query。
5. 点击一个异常运行，确认右侧详情顶部显示：
   - 失败原因标签
   - 当前处理建议
   - 一段具体排障建议

## 范围外

- 本版不接外部可观测平台。
- 本版不使用 LLM 自动诊断失败原因。
- 本版不发送主动告警通知。
- 分类规则是轻量启发式规则，后续可结合结构化节点错误码和 Outbox 告警继续增强。
