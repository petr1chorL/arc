# 评估模板库与工作流评估节点设计

> 日期：2026-07-14
> 状态：已确认
> 对应 PRD：`.scratch/evaluation-template-node/PRD.md`

## 1. 设计目标

本设计只解决一条端到端用户路径：

1. 用户在评估中心创建并发布一个绑定模型的评估模板。
2. 用户在工作流中添加评估节点并选择该模板的已发布版本。
3. Runtime 使用唯一上游产出物和模板绑定模型执行评分。
4. 系统校验模型结果、计算总分和通过状态。
5. 用户在运行详情中看到总分、总评理由，以及每个维度的分数和理由。

评估节点只产出质量判断，不自动决定流程方向，不自动创建人工任务，也不自动重跑或修复上游。

## 2. 当前事实

- `RubricRecord`、`RubricVersionRecord`、`EvaluationRecord` 和 Rubric 生命周期 API 已存在。
- Rubric 已支持 `judgeType=llm` 和 `judgeModel`，但只保存模型名称，没有绑定 Workspace
  `ModelProvider` 资产。
- `ModelJudgeGateway` 当前要求模型返回维度名称、权重、分数、总分、状态和一条总理由；它没有
  逐维度理由，也没有用模板逐项核对维度，更没有由系统重算总分。
- `ExecutionService` 只独立执行 `agent` 和 `human`。包括已有 seed 中 `evaluation` 在内的其他
  节点都把输入原样透传，因此当前不存在真实工作流评估节点。
- `Evaluations.tsx` 已超过三千行，同时加载模板、直接评估、记录、Golden Set、Regression、
  趋势、失败分析、Remediation 和复测状态。
- Workflow Version 已能原样保存节点 `data`，无需再创建第二套图序列化机制。

## 3. 方案比较

### 方案 A：只在前端增加“评估”节点，继续调用现有直接评估 API

优点是改动少。缺点是工作流运行本身仍不知道评估事实，Node Run、Token、成本、失败停止和
版本追溯都会断裂；异步 Worker 也无法复用浏览器发起的第二次请求。

结论：拒绝。它会制造“画布已经配置评估，但 Runtime 仍在透传”的错误完成感。

### 方案 B：在 `ExecutionService` 内复制现有直接评估实现

优点是可以快速运行。缺点是 API 评估和工作流评估会拥有两套 Judge 校验、算分、错误和持久化
逻辑，随后必然漂移。

结论：拒绝。复制不是可接受的最小实现。

### 方案 C：提取共享 Evaluation Service，并让 API 与 Runtime 共用

保留现有 Rubric 与 Evaluation 数据模型，提取一个不依赖 HTTP 的评估应用服务；直接评估 API
和 Workflow Runtime 都通过该服务完成模板解析、Provider 解析、Judge 调用、结果校验、系统算分
和 Evaluation Record 持久化。

结论：采用。它是最小但完整的执行边界。

## 4. 页面收口方案比较

### 方案 1：继续在同一页面使用大量折叠区或 Tab

不会减少状态、请求和职责，只是把复杂度藏起来。

结论：拒绝。

### 方案 2：删除旧回归与修复页面、接口和数据

页面最干净，但会破坏历史数据、Artifact 深链和已经存在的质量运营能力。

结论：拒绝。

### 方案 3：评估中心改为模板库，旧页面保留为次级质量运营路由

`/w/:workspaceSlug/evaluations` 只展示模板库。现有大页面移动到次级路由
`/w/:workspaceSlug/quality-operations`，不放入主导航；已存在的 `taskId` 深链显式重定向到
次级路由。旧数据和 API 保留。

结论：采用。它满足用户看到的简化结果，同时保持可逆和不丢数据。

## 5. 领域与数据模型

### 5.1 用户术语

- 界面使用“评估模板”。
- 代码、数据库和领域文档继续使用 `Rubric`。
- “评估”与“质量门禁”继续区分：评估产生判断，质量门禁或条件分支消费判断并决定路由。

### 5.2 Rubric Dimension

现有维度只有 `name` 和 `weight`。新模板维度为：

```ts
interface RubricDimension {
  id: string
  name: string
  weight: number
  criteria: string
}
```

约束：

- `id` 由系统生成并在编辑时保持稳定；重命名不能改变 ID。
- 同一模板内 `id` 和标准化后的 `name` 都必须唯一。
- `weight` 为 1-100 的整数，全部维度权重合计必须为 100。
- `criteria` 非空，用于告诉 Judge 该维度判断什么。

维度仍保存在 Rubric 的 JSON 字段中，不新增维度表。第一切片没有独立查询、复用或权限需求，
拆表只会扩大事务与迁移面。

### 5.3 Rubric 模型绑定

Rubric 增加：

```ts
modelProviderId: string | null
judgeModel: string
```

新建或重新发布、并希望供 Workflow Evaluation Node 使用的模板必须：

- 使用 `judgeType=llm`。
- 绑定当前 Workspace 中配置完整且状态不是 `disabled` 的 `ModelProvider`。
- 提供非空 `judgeModel`；默认可取 Provider 的 `defaultModel`，但保存后成为模板字段。

当前 Provider 生命周期只有 `draft/disabled`，没有独立激活入口；本切片沿用现有 Agent 绑定语义，
将“未停用”视为可用，不额外扩展 Provider 生命周期。

Rubric Version 快照保存 `modelProviderId` 与 `judgeModel`，不保存密钥值，也不把 Secret Ref
写进公开模板快照。Runtime 根据 Provider ID 读取当前 Provider 的连接配置和 Secret Ref，
同时使用版本快照中的 `judgeModel`。这样模型语义由模板版本固定，连接与凭证仍可运维轮换。

显式传入的 `judgeModel` 必须优先于全局默认模型；只有没有显式模型的旧调用才允许使用全局默认。

### 5.4 旧 Rubric 兼容

旧 Rubric 与历史版本不做破坏性改写：

- 缺少维度 ID、维度标准或 Provider 绑定的版本标记为“旧版模板”。
- 旧版模板仍可在次级质量运营页面读取和用于原有历史记录。
- 旧版模板不能直接被新的 Workflow Evaluation Node 选择。
- 用户编辑旧 Rubric、补齐维度标准与 Provider 后发布新版本，才成为可选模板。

## 6. Workflow Evaluation Node 契约

### 6.1 前端节点数据

```ts
interface EvaluationNodeData extends WorkflowNodeData {
  kind: 'evaluation'
  rubricRef: {
    rubricId: string
    versionId: string
    version: string
    name: string
  }
}
```

`rubricRef` 在用户选择模板版本时写入 Workflow Draft，发布 Workflow 时再次由后端校验。
显示用名称可以变化，但执行只相信 `rubricId + versionId + version`。

### 6.2 图约束

- Evaluation Node 必须恰好有一条入边。
- Evaluation Node 可以有零条或多条出边；第一切片不负责条件路由。
- 上游节点输出必须为非空文本或可序列化为非空文本的数据对象。
- 发布校验必须确认 Rubric、Rubric Version、Model Provider 均属于当前 Workspace。
- Rubric 必须为 `active`，版本必须存在且满足新模板契约；Provider 必须配置完整且未停用。

现有“质量门禁”节点继续兼容已保存 Workflow，但从新增节点面板隐藏，避免用户继续创建尚未实现
运行语义的门禁节点；本次不删除历史 `gate` 节点。

### 6.3 Workflow Version 固化

Workflow Version 保留 `rubricRef`，不在发布时自动替换为模板的“最新版本”。模板后续发布新版本
不会改变已有 Workflow Version；构建者必须编辑 Workflow Draft 并重新选择、重新发布。

## 7. Judge 请求与响应

### 7.1 给模型的输入

Judge 输入快照包含：

- Prompt 版本。
- Rubric ID 与版本。
- 模板名称、总体评分要求、通过分。
- 每个维度的 ID、名称、权重与评分标准。
- 被评估产出物文本。
- `subjectType`、`subjectId`、Workflow Run ID、上游 Node Run ID 和评估 Node Run ID。
- Model Provider ID 与请求模型名；不包含 Base URL、Secret Ref 或密钥值。

### 7.2 模型只允许返回

```json
{
  "overallReason": "整体方案可执行，但风险响应仍不充分。",
  "dimensions": [
    {
      "dimensionId": "risk-control",
      "score": 77,
      "reason": "识别了风险，但没有明确触发阈值和负责人。"
    }
  ]
}
```

模型不返回权重、维度名称、总分或通过状态。即使返回，服务端也忽略这些字段。

### 7.3 严格校验

- `overallReason` 必须为非空字符串。
- `dimensions` 必须与模板维度 ID 集合完全一致。
- 每个维度只能出现一次，不允许缺失、重复或模板外维度。
- `score` 必须是 0-100 的整数。
- 每个 `reason` 必须为非空字符串。

无效 JSON 或违反上述契约时由 `ModelJudgeGateway` 在现有有限次数内重试。每次尝试产生的 Token
都要累计；耗尽后抛出携带累计用量和脱敏错误的 Judge 失败，不使用默认分或旧确定性评分兜底。

## 8. 系统计算的评估结果

服务端用模板快照生成最终结果：

```ts
interface EvaluationResult {
  evaluationRecordId: string
  templateId: string
  templateVersion: string
  modelProviderId: string
  modelProviderName: string
  model: string
  totalScore: number
  passed: boolean
  overallReason: string
  dimensions: Array<{
    dimensionId: string
    dimensionName: string
    score: number
    weight: number
    weightedScore: number
    reason: string
  }>
}
```

计算规则：

- `weightedScore = round(score * weight / 100, 2)`。
- `totalScore = round(sum(score * weight / 100))`，保持现有 0-100 整数 `score` 存储契约。
- `passed = totalScore >= passScore`。

`totalScore`、权重、名称和 `passed` 都由系统生成。模型结果只提供逐维度分数、逐维度理由和总评理由。

## 9. Evaluation Service

新增独立的 `EvaluationService`，不抛出 `HTTPException`。职责：

1. 按 Workspace、Rubric ID 和 Version ID 读取已发布快照。
2. 校验 Rubric 与 Provider 当前可用状态。
3. 解析 Provider 连接配置并调用 Judge Gateway。
4. 校验维度结果并计算加权结果、总分和通过状态。
5. 创建 Evaluation Record。
6. 返回标准化结果、实际模型、尝试次数和累计 Token。

直接评估 API 把领域错误转换成 4xx；Workflow Runtime 把同一错误写入失败 Node Run，并停止下游。

`JudgeGatewayResult` 增加实际模型、累计 `promptTokens`、`completionTokens` 和 `attempts`。
Judge 失败也携带已经产生的累计用量，从而避免失败调用从成本汇总中消失。

## 10. Runtime 执行顺序

```text
读取 Workflow Version
  -> 取得唯一上游 Node Run 与输出
  -> 先创建 evaluation Node Run（running）
  -> Evaluation Service 校验模板与 Provider
  -> ModelJudgeGateway 有限重试
  -> 系统校验维度并算分
  -> 创建 Evaluation Record
  -> Node Run 写入结构化 JSON、score、model、Token、cost、attempts
  -> 继续后继节点
```

事务边界：

- Evaluation Record 与成功 Node Run 在同一数据库事务中提交。
- Judge 调用发生后若结果无效，失败 Node Run 仍保存累计 Token、成本、尝试次数和脱敏错误。
- 失败时不创建成功 Evaluation Record，不写成功评估产出物，不执行后继节点。

### 10.1 低分语义

`passed=false` 仍然是一次成功完成的 Evaluation Node Run。它不自动把 Workflow Run 标为
“需介入”，也不自动创建 Human Review。

现有 `finish_run` 的低分自动复核只保留给旧 Agent 基础质量分；Evaluation Node 的 `score`
必须从这条隐式复核规则中排除。后续如果需要人工审核，用户应显式连接 Human Node。

### 10.2 产出物语义

- 上游 Artifact 保持不变。
- Evaluation Record 是独立质量事实，`subjectType=node_run`、`subjectId=上游 Node Run ID`。
- Evaluation Node 输出的结构化 JSON 可以形成自己的 Artifact，但必须关联评估 Node Run，不能
  覆盖或伪装成被评估的上游 Artifact。
- Node 输出包含 `evaluationRecordId`，运行详情可从 Node Run 直接定位对应评估记录。

## 11. 前端信息架构

### 11.1 评估中心主页面

只加载：

- Rubric 列表。
- 当前 Workspace Model Provider 列表。
- 用户打开某模板时才加载其版本列表。

主页面提供：新建、编辑、发布、停用、查看版本。模板卡展示状态、版本、维度数、通过分、Provider
和模型。不展示 Secret Ref，更不展示密钥值。

模板表单字段：名称、适用产出物、总体评分要求、通过分、Provider、模型，以及维度名称、权重、
评分标准。新页面不提供直接评估 Runner、Regression 或 Remediation 操作。

### 11.2 次级质量运营页面

现有 `Evaluations.tsx` 移动为 `QualityOperations.tsx`，保持原有请求和行为，避免同时重写三千行旧功能。
该路由不进入主导航，但模板页可以提供一个低强调度的“历史质量运营”入口。

兼容规则：

- `/evaluations` -> 新模板库。
- `/evaluations?taskId=...` -> 保留查询参数并重定向到 `/quality-operations?taskId=...`。
- Artifact 等内部链接改为直接生成新次级路由。

### 11.3 工作流编排

- 节点面板增加“评估”，隐藏尚无真实语义的“质量门禁”新增入口。
- Inspector 只允许选择可用于工作流的已发布模板版本。
- 选择后只读展示维度、通过分、Provider 和模型；节点内不能覆盖模型。
- 没有可用模板时展示“先到评估中心发布模板”的明确入口。

### 11.4 运行详情

Evaluation Node 卡片展示总分和通过状态；详情展示总评理由、每个维度的分数、权重、加权分和理由，
以及模板版本、Provider 名称和实际模型。

## 12. API 与持久化变化

预计变化：

- Rubric write/read 增加 `modelProviderId`；维度增加 `id` 与 `criteria`。
- `rubrics` 增加可空 `model_provider_id`，用于兼容旧记录。
- `evaluations.dimension_scores` JSON 增加 `dimensionId`、`weightedScore` 和 `reason`。
- Evaluation Record 的 `evaluatorInput` 增加 Workflow/Node/Provider 追溯字段，但不包含秘密配置。
- Workflow API 不新增独立评估端点；节点通过现有 Workflow Draft/Version 快照保存。
- 现有 Rubric 直接评估端点改为调用共享 Evaluation Service，响应保持向后兼容并新增维度字段。

不新增维度表，不删除 Regression/Remediation 表，不改变旧记录的历史快照。

## 13. 权限、审计与安全

- 模板列表沿用 `asset.read`；创建/编辑沿用 `rubric.write`；发布沿用 `rubric.publish`；停用沿用
  `asset.deactivate`；工作流运行沿用现有运行权限。
- 发布 Workflow 时以当前 Workspace 校验 Rubric Version 与 Provider，不能跨 Workspace 猜 ID。
- 运行时再次校验，防止发布后 Provider 被停用或数据被非法修改。
- 审计记录模板创建、编辑、发布、停用和 Workflow Run；Evaluation Record 提供评估事实。
- Prompt、错误、响应和公开快照不得包含 API Key、请求头或密钥值。
- Provider 只保存和使用后端环境变量名称形式的 Secret Ref，沿用现有出口 Host 白名单。

## 14. 失败处理

| 场景 | 设计结果 |
|---|---|
| 模板没有发布版本 | Workflow 发布失败 |
| 旧模板缺少维度标准或 Provider | 不出现在节点可选列表；直接引用时发布失败 |
| 模板或版本跨 Workspace | 404/发布校验失败，不泄露目标是否存在 |
| Provider 已停用或缺少 Secret Ref | Evaluation Node 失败并保存脱敏原因 |
| 上游输出为空 | Evaluation Node 不调用模型，直接失败 |
| 多条入边 | Workflow 发布失败 |
| Judge 无效 JSON 或维度不匹配 | 有限重试；耗尽后失败 |
| Judge 返回低分 | 节点成功，`passed=false`，继续后继节点 |
| 模板发布新版本 | 已发布 Workflow 继续使用旧版本 |
| 旧 `taskId` 深链 | 重定向到次级质量运营页面并保留上下文 |

## 15. 测试设计

### 15.1 后端聚焦测试

- Rubric 维度 ID/名称唯一、标准非空、权重合计 100。
- 模板发布校验 Provider 属于同 Workspace、配置完整且状态不是 `disabled`。
- Judge 正常返回逐维度理由，系统忽略模型额外总分并自行计算。
- 缺失、重复、额外维度，越界分数、空维度理由、空总评理由和无效 JSON。
- 重试累计 Token；失败也保留累计用量和脱敏错误。
- Workflow 发布拒绝缺少模板、多入边、旧模板、停用 Provider 和跨 Workspace 引用。
- Agent -> Evaluation -> End 成功运行，生成 Node Run、Evaluation Record 和结构化输出。
- `passed=false` 不自动创建 Human Review，后继节点仍运行。
- 评估失败停止后继节点，不创建成功记录或成功 Artifact。
- Workflow Version 固定旧 Rubric Version，不随新模板版本漂移。

### 15.2 前端聚焦测试

- 评估中心只加载模板和 Provider，不加载 Regression/Remediation 数据。
- 模板创建、编辑、发布、停用和版本列表。
- 维度评分标准、唯一性、权重与 Provider/模型必填校验。
- 工作流添加 Evaluation Node、选择已发布兼容模板、保存和重新加载引用。
- 旧模板和停用模板不可选，没有模板时出现明确入口。
- `WorkflowNode` 使用评估图标；新增面板不再提供未实现的 Gate。
- 运行详情展示每个维度的理由。
- 带 `taskId` 的旧 URL 保留参数并进入次级质量运营页面。

### 15.3 回归与浏览器验证

- 现有 Rubric 直接评估、Regression 和 Remediation 后端测试继续通过。
- 现有 Agent/Human Workflow 运行、恢复和 Artifact 行为继续通过。
- 前后端全量测试、`npm run lint`、`npm run build` 和 `npm run deploy:check` 通过。
- 登录后的浏览器路径完整覆盖：创建模板 -> 发布 -> 工作流选择 -> 运行 -> 查看逐维度理由。
- 视觉检查确认评估中心主页面只呈现模板库，旧 `taskId` 深链仍可到达原任务。

## 16. 实施切片

### 切片 1：真正的工作流评估节点

- 扩展模板契约与 Provider 绑定。
- 严格 Judge 输出和系统算分。
- 提取 Evaluation Service。
- 增加 Workflow Evaluation Node、发布校验、Runtime 执行和运行详情。

### 切片 2：评估中心收口

- 新建轻量模板库页面。
- 将旧大页面迁移到次级质量运营路由。
- 迁移 `taskId` 深链并停止主页面加载旧运营数据。

切片 2 依赖切片 1。不能先隐藏旧功能，再留下一个不能实际执行评分的工作流节点。

## 17. 第一性原理与对抗式结论

- 最小闭环只需要模板版本、模型绑定、唯一上游产出物、评估节点和可解释结果。
- Regression、Golden Set、Remediation 和自动路由都不是第一切片的必要条件。
- 仅增加前端节点、信任模型自报总分、运行时取最新模板或继续全局模型回退都会制造错误完成感。
- Provider、Workspace、版本、Token/成本、失败记录和上游产出物必须在同一链路中可追溯。
- 本设计不宣称 Judge 已校准或评分具有统计可靠性，只提供一次可重复配置、可解释和可审计的模型判断。

## 18. 审阅结论

用户已于 2026-07-14 确认采用“模板库作为主页面，旧质量运营页面保留为不在主导航中的
次级路由”的整体方案。实施按两个切片推进：先完成 Issue 01 的真实工作流评估节点，再实施
Issue 02 的评估中心页面收口。
