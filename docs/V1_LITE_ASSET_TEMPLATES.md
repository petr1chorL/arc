# V1.0 Lite 试点资产模板包

> 更新时间：2026-06-29
> 适用流程：`docs/V1_LITE_PILOT_PROCESS.md`

## 用法

这份文档是手工配置模板，不是自动导入脚本。构建者需要在 ARC.ONE 页面中按模板创建资产、保存草稿、发布不可变版本，并把版本号记录到 `docs/V1_LITE_E2E_ACCEPTANCE.md`。

## 第一性原理

模板包只服务一个目标：让默认试点流程能从业务输入稳定流转到结构化产出、人工审核、质量评分和回归样本。

## 对抗式审查

- 不把模板当成已导入数据。
- 不在模板里保存 API Key、Token 或真实客户数据。
- 不跳过 Human Review、Rubric 或 Golden Set。
- 不把 V1.0 Lite 试点模板描述成完整生产治理体系。

## 资产清单

| 资产 | 数量 | 必须发布版本 | 验收记录位置 |
|---|---:|---|---|
| Agent | 4 | 是 | Agent 版本 |
| Workflow | 1 | 是 | Workflow 版本 |
| Human Review 节点 | 1 | 随 Workflow 发布 | Human Task ID |
| Rubric | 1 | 是 | Evaluation ID |
| Golden Set | 1 | 否，但必须保存样本 | Regression Run ID |

## Workflow 输入 Schema

```json
{
  "type": "object",
  "required": ["sourceNotes", "businessContext", "desiredOutput", "riskConcerns"],
  "properties": {
    "sourceNotes": {
      "type": "string",
      "title": "课程笔记或业务材料"
    },
    "businessContext": {
      "type": "string",
      "title": "业务背景"
    },
    "desiredOutput": {
      "type": "string",
      "title": "目标输出"
    },
    "riskConcerns": {
      "type": "string",
      "title": "风险关注"
    }
  }
}
```

## 最终产出物结构

```json
{
  "problemModel": {
    "businessGoal": "string",
    "actors": ["string"],
    "constraints": ["string"],
    "risks": ["string"]
  },
  "workflowDesign": {
    "nodes": [
      {
        "name": "string",
        "type": "agent | human_review | evaluation",
        "input": "string",
        "output": "string",
        "owner": "string"
      }
    ]
  },
  "rubric": {
    "dimensions": [
      {
        "name": "string",
        "weight": 0,
        "passingRule": "string"
      }
    ]
  },
  "reviewDecision": {
    "decision": "approved | approved_with_changes | rejected",
    "reason": "string"
  },
  "finalPlan": "string"
}
```

## Agent 模板

### Agent 1：信息抽取与问题建模

| 字段 | 配置 |
|---|---|
| 名称 | 信息抽取与问题建模 |
| 职责 | 从课程笔记、业务背景和风险关注中抽取可执行的问题模型 |
| 模型 | 使用 Workspace 已配置的默认模型 Provider |
| Tools | 无必需 Tool |
| Skills | 结构化提取、风险识别 |
| 输入 | Workflow 输入 JSON |
| 输出 | `problemModel` JSON |

System Prompt：

```text
你是企业 AI 赋能试点中的信息抽取与问题建模 Agent。

目标：
1. 只根据输入材料抽取事实、约束、角色、输入输出和风险。
2. 把模糊想法整理成可供后续 Workflow 设计使用的问题模型。
3. 不补充输入中不存在的业务事实。

输出必须包含：
- businessGoal：一句话业务目标。
- actors：相关角色列表。
- inputs：关键输入材料。
- desiredOutputs：期望产出。
- constraints：限制条件。
- risks：风险列表。
- openQuestions：仍需人工确认的问题。

如果信息不足，把缺口写入 openQuestions，不要编造。
```

验收要点：

- 能区分事实、推断和待确认问题。
- 风险不少于 3 条。
- 不输出完整方案，只输出问题模型。

### Agent 2：AI 赋能工作流设计

| 字段 | 配置 |
|---|---|
| 名称 | AI 赋能工作流设计 |
| 职责 | 把问题模型转成可执行的 Agentic Workflow |
| 模型 | 使用 Workspace 已配置的默认模型 Provider |
| Tools | 无必需 Tool |
| Skills | 流程建模、节点边界设计 |
| 输入 | Agent 1 的 `problemModel` |
| 输出 | `workflowDesign` JSON 和节点表 |

System Prompt：

```text
你是企业 Agentic Workflow 设计 Agent。

目标：
1. 基于问题模型设计最小可执行 Workflow。
2. 每个节点必须说明输入、输出、负责人、是否需要人工审核。
3. 高风险判断必须进入 Human Review，不得全部自动化。

输出必须包含：
- nodes：节点列表。
- edges：节点连接顺序。
- humanReviewPlacement：为什么在该位置放人工审核。
- qualityGates：每个关键节点的质量门禁。
- outOfScope：当前试点不做的能力。

不要设计超过 7 个节点；V1.0 Lite 优先可跑通，不追求大而全。
```

验收要点：

- 至少包含 1 个 Human Review 节点。
- 每个节点都有明确输入和输出。
- 有范围外说明，避免试点失控。

### Agent 3：评分与验收体系设计

| 字段 | 配置 |
|---|---|
| 名称 | 评分与验收体系设计 |
| 职责 | 为最终方案设计 Rubric、权重、门槛和失败处理 |
| 模型 | 使用 Workspace 已配置的默认模型 Provider |
| Tools | 无必需 Tool |
| Skills | Rubric 设计、质量门禁设计 |
| 输入 | Agent 1 问题模型和 Agent 2 工作流设计 |
| 输出 | `rubric` JSON |

System Prompt：

```text
你是 AI 赋能方案的质量评价 Agent。

目标：
1. 设计可观察、可复测、可解释的 Rubric。
2. 每个评分维度必须有权重、评分锚点和失败处理建议。
3. 权重必须服务业务目标，而不是平均分配。

输出必须包含：
- dimensions：评分维度。
- totalPassingScore：总分通过线。
- hardGates：硬性门禁。
- failureActions：低分时的处理动作。
- weightRationale：每个权重的依据。

禁止只写“好/一般/差”这类不可复测描述。
```

验收要点：

- 权重总和等于 100。
- 至少 1 个硬性门禁。
- 每个维度都有失败处理建议。

### Agent 4：审核后修订

| 字段 | 配置 |
|---|---|
| 名称 | 审核后修订 |
| 职责 | 根据人工审核意见生成最终方案文档 |
| 模型 | 使用 Workspace 已配置的默认模型 Provider |
| Tools | 无必需 Tool |
| Skills | 方案修订、变更说明 |
| 输入 | 原始方案、Rubric 草案、人工审核意见 |
| 输出 | `finalPlan` 和变更说明 |

System Prompt：

```text
你是 AI 赋能方案修订 Agent。

目标：
1. 根据人工审核意见修订方案。
2. 保留关键修改理由。
3. 不删除审核人指出的风险，必须在最终方案中回应。

输出必须包含：
- finalPlan：最终方案正文。
- changeLog：逐条说明采纳了哪些审核意见。
- unresolvedRisks：仍未解决的风险。
- nextIteration：建议进入 V1.1+ 的事项。

如果审核意见与输入事实冲突，先标记冲突，不要强行改写事实。
```

验收要点：

- 能追溯审核意见如何进入最终方案。
- 未解决风险不会被隐藏。
- 结论能直接进入验收手册记录。

## Workflow 模板

| 顺序 | 节点 | 类型 | 输入 | 输出 | 质量门禁 |
|---:|---|---|---|---|---|
| 1 | Start | trigger | Workflow 输入 JSON | 原始输入 | 必填字段完整 |
| 2 | 信息抽取与问题建模 | agent | 原始输入 | problemModel | openQuestions 不为空时标记待确认 |
| 3 | AI 赋能工作流设计 | agent | problemModel | workflowDesign | 至少 1 个人工审核节点 |
| 4 | 评分与验收体系设计 | agent | problemModel + workflowDesign | rubric | 权重总和 100，硬门禁存在 |
| 5 | 业务负责人审核 | human_review | workflowDesign + rubric | reviewDecision | 必须认领后才能通过或驳回 |
| 6 | 审核后修订 | agent | reviewDecision + 上游产出 | finalPlan | 必须回应每条审核意见 |
| 7 | Rubric 评分 | evaluation | finalPlan + rubric | Evaluation Record | 总分 >= 80，风险控制 >= 70 |
| 8 | End | end | Evaluation Record + finalPlan | 验收记录 | Run ID、Human Task ID、Evaluation ID 可追溯 |

推荐连线：

```text
Start -> 信息抽取与问题建模
信息抽取与问题建模 -> AI 赋能工作流设计
AI 赋能工作流设计 -> 评分与验收体系设计
评分与验收体系设计 -> 业务负责人审核
业务负责人审核 -> 审核后修订
审核后修订 -> Rubric 评分
Rubric 评分 -> End
```

发布要求：

- 所有 Agent 先发布版本，再绑定到 Workflow 节点。
- Workflow 草稿通过 DAG 校验后再发布版本。
- Human Review 节点必须指定具备审核资格的业务负责人或产品负责人。

## Human Review 模板

审核任务标题：

```text
审核 AI 赋能方案试点产出
```

审核说明：

```text
请判断本次方案是否可以进入 V1.0 Lite 验收。重点检查业务目标、节点边界、人工审核位置、Rubric 可操作性、风险控制和后续迭代范围。
```

审核人必须填写：

- 结论：通过 / 修改后通过 / 驳回。
- 主要原因。
- 必须修改项。
- 可后置到 V1.1+ 的事项。
- 是否允许沉淀为 Golden Sample。

通过标准：

- 业务目标清楚。
- Workflow 节点没有明显缺失。
- 高风险点没有被全自动化绕过。
- Rubric 能指导真实改进。
- 没有泄露密钥或敏感数据。

## Rubric 模板

| 维度 | 权重 | 90-100 分 | 70-89 分 | 0-69 分 |
|---|---:|---|---|---|
| 业务目标清晰度 | 20 | 目标、角色、成功标准明确 | 目标清楚但角色或标准不完整 | 目标模糊，无法判断成败 |
| 工作流可执行性 | 25 | 节点输入输出清楚，能按顺序流转 | 节点基本完整但部分边界需补充 | 节点缺失或顺序不可执行 |
| 质量评价可操作性 | 25 | Rubric 可量化、可复测、能驱动修订 | 有评分维度但锚点不够清楚 | 评分主观，无法复测 |
| 风险控制 | 20 | 覆盖权限、审核、安全、成本和失败恢复 | 覆盖主要风险但处理动作不足 | 高风险点被忽略或绕过人工审核 |
| 可迭代性 | 10 | 明确 V1.1+ 后续增强项和边界 | 有后续方向但优先级不清 | 没有后续迭代路径 |

通过门槛：

- 总分 >= 80。
- 风险控制 >= 70。
- 如果出现密钥泄露、跳过人工审核、无法追溯 Run ID，直接失败。

Rubric JSON 草案：

```json
{
  "name": "AI 赋能方案 V1.0 Lite Rubric",
  "totalPassingScore": 80,
  "hardGates": [
    "不得泄露密钥或敏感数据",
    "不得跳过 Human Review",
    "必须能追溯 Run ID、Human Task ID 和 Evaluation ID"
  ],
  "dimensions": [
    {
      "name": "业务目标清晰度",
      "weight": 20,
      "passingScore": 70
    },
    {
      "name": "工作流可执行性",
      "weight": 25,
      "passingScore": 70
    },
    {
      "name": "质量评价可操作性",
      "weight": 25,
      "passingScore": 70
    },
    {
      "name": "风险控制",
      "weight": 20,
      "passingScore": 70
    },
    {
      "name": "可迭代性",
      "weight": 10,
      "passingScore": 60
    }
  ]
}
```

## Golden Set 样例

### 样例 1：平台落地路线

输入：

```json
{
  "sourceNotes": "安克 AI 课程笔记与个人思维导图摘要",
  "businessContext": "希望构建一个企业 AI 赋能平台，用于编排 Agent、人工审核和质量评分",
  "desiredOutput": "平台落地路线与一个可执行试点流程",
  "riskConcerns": "不要大而全失控，先快速试点；质量评分体系要可落地"
}
```

期望结果：

- 明确 V1.0 Lite 先跑一条试点流程。
- 至少包含 Agent、Workflow、Human Review、Evaluation、Observability。
- 说明哪些能力后置到 V1.1+。
- Rubric 权重可解释，总分通过线明确。

### 样例 2：客服知识沉淀流程

输入：

```json
{
  "sourceNotes": "客服团队有大量问答记录，但沉淀成知识库慢，质量不稳定",
  "businessContext": "目标是把高频问题转成可审核的知识条目",
  "desiredOutput": "客服知识沉淀 Agent 工作流",
  "riskConcerns": "错误答案、重复知识、未经审核发布"
}
```

期望结果：

- 识别输入为问答记录，输出为知识条目。
- Human Review 放在发布前。
- 风险控制覆盖错误答案和重复条目。
- 评分维度包含准确性、可复用性和审核完整性。

### 样例 3：新品卖点提炼流程

输入：

```json
{
  "sourceNotes": "新品有参数、竞品对比和用户反馈，但卖点表达分散",
  "businessContext": "市场团队需要形成可审核的卖点草案",
  "desiredOutput": "新品卖点提炼与审核流程",
  "riskConcerns": "夸大宣传、事实依据不足、不同渠道口径不一致"
}
```

期望结果：

- 区分事实依据和营销表达。
- Human Review 检查夸大宣传风险。
- Rubric 包含事实准确性、差异化、渠道一致性。
- 未确认事实进入 openQuestions。

## 配置检查清单

- [ ] 4 个 Agent 草稿已创建。
- [ ] 4 个 Agent 均已发布版本。
- [ ] 1 条 Workflow 草稿已创建。
- [ ] Workflow 包含 Human Review 节点。
- [ ] Workflow 已绑定已发布 Agent 版本。
- [ ] Workflow 已发布版本。
- [ ] Rubric 已创建并启用。
- [ ] Golden Set 至少包含 1 条样例。
- [ ] 端到端验收手册已记录 Agent Version、Workflow Version、Run ID、Human Task ID 和 Evaluation ID。

## 后续可自动化项

这些能力后置到 V1.1+：

- 模板一键导入。
- Golden Set 批量导入。
- Rubric JSON 校验器。
- 从飞书云文档读取真实课程笔记。
- 自动生成试点交付报告。
