# ARC.ONE 当前版本实现说明

> 对应版本：V0.13A 异步任务队列第一切片
> 上一阶段：V0.8F 轻量告警 / 通知 Outbox
> 更新时间：2026-06-27

## 1. 当前版本是什么

当前版本是 React 单页应用与 FastAPI 服务组成的可运行原型。

Agent 资产页和工作流设计器已经接入 SQLAlchemy。Agent 支持草稿编辑、版本发布、停用和测试运行；工作流支持草稿持久化、DAG 校验、Agent 版本引用、不可变发布和按拓扑顺序运行。

运行实例、节点运行、不可变产出物版本和正式 Human Task 已持久化。工作流在 Human 节点暂停，能够经过认领、会签、人工决策后继续、重跑或终止。人工修改会保存 Diff 并形成反馈候选，专家确认后可沉淀为 Golden Sample。

运行中心与人工审核工作台已切换到真实 API。模型调用通过可注入的 OpenAI-compatible ModelGateway 完成；自动化测试使用 FakeGateway，不依赖外部网络。

Agent 执行已引入第一版 Runtime 合约：`app.agent_runtime` 负责统一 Agent 输入、输出、脱敏错误、Token、成本、评分、尝试次数、耗时和工具调用占位。Agent 直接测试运行与工作流 Agent 节点都通过 `ExecutionService.execute_agent` 调用该 Runtime，再映射到 `NodeRunRecord`。

Tool / Skill 已新增第一版 Workspace 级资产库后端：`tool_skill_assets` 表保存 `tool` 与 `skill` 两类资产，支持创建、列表查询、参数 Schema、状态、适配类型、适配配置和 Workspace 隔离。Agent 更新和发布时会校验所绑定的 Tools / Skills 必须是当前 Workspace 内已启用资产。`tool_skill_asset_invocations` 表提供调用日志查询能力，并已支持 HTTP Tool 测试调用写入成功或失败日志。

HTTP Tool 适配当前采用可注入 `HttpToolGateway`。自动化测试可使用 Fake Gateway；默认运行时使用 `HttpxToolGateway`，只有 `TOOL_HTTP_ALLOWED_HOSTS` 配置了目标 host 时才允许 GET / POST 外联，超时由 `TOOL_HTTP_TIMEOUT_SECONDS` 控制。MCP Tool 当前支持可注入 `McpToolGateway` 的测试调用骨架，默认不连接真实 MCP Server。Agent 直接测试运行和工作流 Agent 节点执行时，会调用已绑定的 HTTP Tool 并写入带 Agent、Run 和 NodeRun 上下文的调用日志。运行观测详情会把 Tool 调用日志派生成 `tool_skill_invocation` 执行事件，并关联到对应 NodeRun Span。

评估中心已引入第一版 LLM-as-a-Judge 后端合约：Rubric 可声明 `judgeType=deterministic` 或 `judgeType=llm`，并记录 `judgeModel`。Evaluation 记录保存 `evaluatorType`、`evaluatorModel` 和 `evaluatorInput`，用于复现评分输入。当前 LLM Judge 通过可注入 `JudgeGateway` 执行；默认 `ModelJudgeGateway` 使用现有 OpenAI-compatible `ModelGateway` 请求模型并解析 JSON 评分结果，自动化测试使用 Fake Gateway，不依赖外部网络。

工作流执行新增异步队列第一切片：`RunCreate.asyncMode=true` 时会创建状态为 `排队中` 的 Run 与 `execution_jobs` 队列任务，不立即调用模型；`POST /execution-jobs/next?workerId=...` 可领取当前 Workspace 下一条 `queued` job 并执行，执行完成后回写 Run、NodeRun 和 job 状态。失败但未达到 `max_attempts` 的 job 会重新进入 `queued`，Run 回到 `排队中` 并保留错误原因；达到最大尝试次数后 job 进入 `dead_letter`。队列任务已记录 `lockedBy`、`lockedUntil` 和 `lastHeartbeatAt`，租约未过期的 `running` job 不会被其他 worker 领取，租约过期后可被接管；`POST /execution-jobs/{jobId}/heartbeat?workerId=...` 可延长当前 worker 的租约。`GET /execution-jobs` 支持按状态筛选并返回队列运营字段，运行观测页已展示“执行队列运营”卡片；死信任务可通过 `POST /execution-jobs/{jobId}/requeue` 手动重新入队，队列任务可通过 `POST /execution-jobs/{jobId}/cancel` 主动取消。`app.worker.ExecutionQueueWorker` 提供常驻轮询骨架，可复用 `ExecutionService` 按 Workspace 领取和处理队列任务；`python -m app.worker` 与 `arc-one-worker` 提供 worker 启动入口。默认 `asyncMode=false` 的同步执行路径保持不变。

当前已使用 DeepSeek OpenAI-compatible API 完成真实成功调用验证：Base URL 为 `https://api.deepseek.com`，模型为 `deepseek-v4-pro`。真实 API Key 仅保存在被 Git 忽略的本地 `apps/api/.env` 中。模型单价环境变量尚未配置，因此运行中心的成本暂显示为 `$0.000000`，Token 统计不受影响。

API Key 不进入前端、数据库、仓库和运行响应。

```mermaid
flowchart LR
    A["浏览器"] --> B["React 页面"]
    B --> C["React Router"]
    B --> D["组件状态 useState"]
    B --> E["Agent / Workflow / Run HTTP API"]
    E --> G["FastAPI + SQLAlchemy"]
    G --> H["SQLite / PostgreSQL"]
    G --> I["ModelGateway"]
    B --> F["React Flow DAG"]
```

Agent、工作流、运行记录、Human Task、审核决定、审计事件和反馈数据通过本机 `/api` 发送到 FastAPI，并保存到默认 SQLite 文件 `apps/api/data/arc_one.db`。刷新页面或重启 API 后会重新读取持久化记录。

运行观测详情会把 Workflow Run、Node Run、Human Task 和 Audit Event 派生成统一执行事件流，按 Trace 时间顺序展示。Workspace 级执行事件查询也会把 Remediation Task、修复处理活动和复测 Regression Run 纳入同一事件模型，便于从一个 Trace 复盘完整业务链路。

## 2. 启动链路

### 2.1 HTML 入口

文件：`index.html`

作用：

- 定义中文页面语言。
- 设置移动端 viewport。
- 设置页面标题和描述。
- 挂载 `#root` 容器。
- 加载 `src/main.tsx`。

### 2.2 React 入口

文件：`src/main.tsx`

作用：

- 引入全局 CSS。
- 创建 React Root。
- 渲染根组件 `App`。
- 使用 `StrictMode` 帮助发现潜在副作用问题。

### 2.3 应用路由

文件：`src/App.tsx`

路由关系：

| URL | 页面组件 |
|---|---|
| `/` | `Dashboard` |
| `/workflows` | `Workflows` |
| `/agents` | `Agents` |
| `/evaluations` | `Evaluations` |
| `/runs` | `Runs` |
| `/reviews` | `Reviews` |
| `/observability` | `Observability` |

`Layout` 作为共同外壳，负责侧栏、顶部栏和页面内容区域。

## 3. 应用外壳

文件：`src/components/Layout.tsx`

实现内容：

- 左侧主导航。
- 当前路由高亮。
- 人工审核数量角标。
- Workspace 展示。
- 顶部页面名称。
- 全局搜索输入框外观。
- 通知按钮。
- 生产环境状态展示。
- 使用 React Router 的 `Outlet` 渲染当前页面。

当前限制：

- 全局搜索只有界面，没有搜索逻辑。
- 通知按钮没有通知中心。
- Workspace 不能切换。
- “生产环境”只是展示文本。

## 4. 数据模型

文件：`src/types.ts`

当前 TypeScript 接口覆盖：

### Agent

包含：

- 名称和角色。
- 负责人。
- 模型和版本。
- 在线状态。
- 质量通过率。
- 运行次数。
- 工具列表。

### Rubric

包含：

- 适用产出物。
- 评分维度。
- 维度权重。
- 硬性门禁。
- 自动通过分数。
- 版本。
- 状态：`draft`、`active`、`disabled`。
- 已发布不可变版本快照。

### Evaluation

包含：

- Rubric ID 和 Rubric 版本。
- 运行时 Rubric 快照。
- 被评估对象类型和对象 ID。
- 产出物文本。
- 维度得分。
- 加权总分。
- `passed` / `failed` 状态。
- 评分说明。

### RegressionSampleSet

包含：

- 样本集名称和说明。
- active / disabled 状态。
- 样本总数和 active 样本数。
- 样本输入、期望输出、标签、来源类型、来源 ID。
- 创建人、创建时间和更新时间。

### RegressionRun

包含：

- Run ID。
- 关联 Rubric ID、Rubric 名称和 Rubric 版本。
- 关联 Golden Set ID 与名称；手动样本运行时为空。
- 样本总数、通过数、失败数和通过率。
- 本次运行生成的 Evaluation IDs。
- 本次运行返回的 Evaluation 记录。
- 创建人、创建时间和完成时间。

### RemediationTask

包含：

- 来源 Regression Run ID。
- 失败原因组。
- 优先级、标题和建议动作。
- 代表样本 ID。
- 状态：`open`、`in_progress`、`done`。
- 可选复测 Run ID。
- 可选复测 Run 摘要。
- 复测失败后的回流状态和处理活动记录。

### WorkflowRun

包含：

- 工作流名称。
- 运行状态。
- 进度。
- 启动时间和耗时。
- 得分和成本。
- 当前节点。

### HumanTask

包含：

- 任务状态、分配方式和审核策略。
- 所属运行、Human 节点与来源 Agent 节点。
- 审核人、审核组和参与人快照。
- 截止、升级时间与 SLA 状态。
- 当前产出物版本、会签进度和恢复状态。
- 审计事件、通知 Outbox、反馈候选和 Golden Sample。

这些接口目前由前端手工维护，后续需要由 `packages/contracts` 中的正式 Schema 或 OpenAPI 生成类型替代。

## 5. 演示数据

文件：`src/data/mock.ts`

当前文件仍提供历史演示数组：

- 5 个 Agent。
- 3 套历史 Rubric 演示数据。
- 5 条运行实例。
- 3 条人工审核任务。
- 6 项运营指标。

Agent、工作流、运行中心、人工审核页面和评估中心 Rubric 已改用真实 FastAPI。运营总览仍使用运营指标演示数据。

## 6. 工作流 DAG

### 6.1 页面

文件：`src/pages/Workflows.tsx`

采用：

- `@xyflow/react`
- `useNodesState`
- `useEdgesState`
- `addEdge`
- `ReactFlow`
- `Background`
- `Controls`
- `MiniMap`

### 6.2 当前节点

新建工作流默认初始化 3 个已连线节点：

1. 手动触发。
2. 选择执行 Agent。
3. 流程完成。

左侧节点库可点击添加手动触发、Agent、工具调用、数据查询、条件分支、
质量门禁、人工审核、代码执行、等待节点和流程完成。窄屏下节点库改为
横向滚动，仍可访问全部节点类型。

### 6.3 自定义节点

文件：`src/components/WorkflowNode.tsx`

节点支持以下类型：

- Trigger。
- Agent。
- Tool。
- Data。
- Branch。
- Gate。
- Human。
- Code。
- Wait。
- End。

每种节点使用不同图标和状态颜色。节点左右使用 React Flow Handle 作为连接端点：
左侧空心点是输入，右侧实心点是输出。

### 6.4 已实现交互

- 节点拖动。
- 画布缩放和平移。
- 从上游节点右侧输出点拖到下游节点左侧输入点完成连线。
- 连线随草稿保存并在重新加载后恢复。
- 新建工作流恢复 3 个默认节点和 2 条默认连线。
- 小地图。
- 点击节点打开配置面板。
- 修改节点名称。
- Human 节点配置指定审核人、审核组、组内认领或轮询分配。
- 指定审核人只展示已授予且启用的 Reviewer 资格；未出现的成员需要先到成员与权限绑定 Reviewer 资格。
- Human 节点配置任一通过、全员通过和 N 人通过。
- Human 节点配置截止时间、升级时间和升级组。
- 发布前校验 Human 节点分配、会签人数和 SLA 参数。
- 保存提示。

### 6.5 尚未实现

- 从左侧节点库拖拽进入画布；当前为点击添加。
- 复制、框选和分组节点。
- 撤销和重做。
- 多选和分组。
- 输入输出变量连线。
- 完整节点参数 Schema 编辑器。
- 循环、并行汇聚和子流程。
- 失败后的断点恢复。
- 并行节点、汇聚和条件路由执行。

当前工作流数据链路：

```text
React Flow 节点/连线
→ 平台 Workflow Contract
→ FastAPI + SQLAlchemy 草稿
→ DAG 与 Agent 版本引用校验
→ WorkflowVersion 不可变快照
```

## 7. Agent 资产页

文件：`src/pages/Agents.tsx`

实现：

- 展示 Agent 状态、模型、版本和负责人。
- 展示质量通过率和运行次数。
- 展示工具标签。
- 使用 `useState` 保存搜索词。
- 使用 `useMemo` 过滤 Agent。
- 通过 `GET /api/agents` 加载持久化 Agent。
- 通过弹窗填写名称、职责、负责人和模型。
- 提交前显示字段级校验错误。
- 通过 `POST /api/agents` 创建 Agent。
- 显示加载、空数据、重试和服务端错误状态。
- 创建成功后立即更新列表，刷新后重新读取数据库。
- 每条 Agent 显示明确的“编辑与发布”入口，点击 Agent 名称也可进入详情页。
- 编辑名称、职责、负责人、模型和 System Prompt。
- 配置 Tools 与 Skills。
- 发布不可变 AgentVersion。
- 查看版本历史。
- 停用 Agent，并阻止继续编辑或发布。
- 运行已发布 Agent 版本。
- 展示运行状态、产出、Token、得分和耗时。
- Agent Runtime 已统一直接测试运行和工作流 Agent 节点的执行协议。
- Runtime Result 包含输出、错误、模型、Token、成本、评分、尝试次数、耗时和 `tool_calls` 占位。
- Tool / Skill 资产库后端支持创建和列表查询 Workspace 级工具资产。
- Tool / Skill 资产包含类型、名称、描述、参数 Schema、适配类型、适配配置、状态和创建信息。
- Agent 只能绑定已存在且启用的 Tool / Skill 资产。
- Agent 发布会重新校验资产可用性，禁用资产不会进入不可变版本快照。
- Tool / Skill 调用日志支持 Workspace 级查询，并可按资产、Agent 和状态过滤。
- HTTP Tool 支持后端测试调用，成功与失败都会写入调用日志。
- 测试调用失败时返回脱敏错误，不暴露 provider 原始异常。
- Agent 绑定 HTTP Tool 后，Agent 直接测试运行和工作流 Agent 节点会写入带运行上下文的调用日志。
- HTTP Tool 输出摘要会作为工具调用结果补充进 Agent Runtime 输入。
- 运行观测详情会把 Tool 调用日志展示为执行事件流中的 `tool_skill_invocation` 事件。
- 默认 `HttpxToolGateway` 支持 GET / POST、host allowlist、超时和响应摘要。
- 未配置 `TOOL_HTTP_ALLOWED_HOSTS` 或目标 host 不在允许名单内时，不发起 HTTP Tool 外联。
- MCP Tool 支持可注入网关测试调用和调用日志写入，默认不连接真实 MCP Server。

未实现：

- 模型参数。
- 真实 MCP Server client、session 管理和鉴权。
- HTTP Tool 鉴权头、响应字段映射和更细粒度脱敏策略。
- Agent 版本比较和回滚。
- 聚合后的真实运行统计。

## 8. 评估中心

文件：`src/pages/Evaluations.tsx`

实现：

- 从 FastAPI 读取 Workspace 级评估资产概览。
- 展示反馈候选、待确认候选、已确认候选、Golden Sample、覆盖工作流和覆盖 Agent。
- 展示最近反馈候选的状态、原因和标签。
- 无候选数据时展示空状态。
- 从 FastAPI 读取 Workspace 级 Rubric 卡片。
- 评分维度和权重。
- 硬性门禁。
- Rubric 支持 `judgeType=deterministic` 和 `judgeType=llm`。
- Rubric 支持记录 `judgeModel`。
- 当前 workspace 首次访问时会播种 3 个默认 Rubric，后续访问不会重复创建。
- 自动流转阈值。
- 新建 Rubric 草稿。
- 编辑 Rubric 名称、适用产出物、维度、权重、硬性门禁和通过分数。
- 在 Rubric 配置弹窗中选择确定性评分器或 LLM Judge，并填写 Judge 模型。
- 发布不可变 Rubric 版本。
- 查看已发布 Rubric 版本快照。
- 停用 Rubric，停用后不允许继续编辑或发布。
- 前端校验必填字段、分数范围和维度权重合计。
- 在 Rubric 配置弹窗中运行一次评估。
- 保存 Evaluation 记录，包含 Rubric 快照、维度分、总分和 passed/failed 状态。
- Evaluation 记录包含实际评分器类型、模型和可复现输入快照。
- `judgeType=llm` 的 Rubric 直接评估会通过可注入 Judge Gateway 执行。
- 默认 `ModelJudgeGateway` 会构造 Judge 输入快照、调用 OpenAI-compatible ModelGateway，并解析 JSON 评分结果。
- `ModelJudgeGateway` 会校验维度分 schema，并在 Judge 返回不可解析结果时重试。
- `ModelJudgeGateway` 的 Judge 输入快照和系统提示词包含 `judgePromptVersion=llm-judge-v1`。
- 展示 Evaluation 历史记录列表，包含记录 ID、Rubric 快照名称、评估对象、版本、维度分、总分、状态和评分说明。
- 支持按 `passed` / `failed` 状态筛选评估记录。
- 支持按 Rubric 筛选评估记录；历史记录引用的 Rubric 即使不在当前 Rubric 列表中，也会以记录快照名称出现在筛选项里。
- 页面会从 LLM Judge Evaluation Records 派生校准概览，展示校准样本数、通过率、平均分、模型覆盖和 Prompt 版本覆盖。
- Rubric 配置弹窗运行评估成功后，会把新记录即时插入评估记录列表顶部。
- 支持查看 Evaluation 记录详情，展示评估对象、运行时 Rubric 快照、维度权重、维度得分、待评估产出物和评分说明。
- 支持创建 Workspace 级 Golden Set / 回归样本集。
- 支持向样本集新增样本，记录样本输入、期望输出和标签。
- 支持在批量回归中选择已保存样本集，按 active 样本创建一次持久化 Regression Run。
- 支持轻量批量回归：选择可用 Rubric，输入多条样本后创建一次持久化 Regression Run。
- 批量回归会展示通过率、样本总数、通过数、失败数和每条样本的得分/状态。
- 批量回归的每条样本都会形成独立 Evaluation 记录，并即时合并进评估历史。
- 每次批量回归会沉淀 Regression Run 历史，包含 Rubric、Golden Set、样本统计、通过率和关联 Evaluation IDs。
- `Regression Run History` 会展示最近运行，刷新页面后从后端重新读取。
- `Regression Run History` 支持按 Rubric 和 Run 状态筛选。
- 支持点击 Run 打开详情弹窗，展示 Run 上下文、样本级 Evaluation 记录、输入、分数、状态和评分说明。
- 支持选择基准 Run 与目标 Run 进行轻量对比，展示通过率、样本总数、通过样本和失败样本变化。
- Regression Run 对比会读取两次 Run 详情，并按样本 `subjectId` 展示失败变通过、通过变失败、持续失败和新增失败等样本级变化。
- `Regression Run History` 会基于当前筛选后的最近 Run 展示趋势视图。
- 趋势视图展示最新通过率、较上次变化、平均通过率、最佳通过率和最近最多 8 次 Run 的通过率柱状趋势。
- 通过率低于 70% 的趋势点会标记为风险，便于快速发现回归质量下滑。
- `Regression Run Trend` 内展示 `Regression Run Insight` 洞察卡，基于当前筛选后的趋势给出质量状态、关键事实和下一步建议。
- 洞察卡会展示质量下滑、质量风险、轻微回落、质量改善或质量稳定，并同步展示最新通过率、较上次变化和风险 Run 数。
- `Regression Run Trend` 内展示 `Failure Pattern Summary`，基于当前筛选后的最新 Run 失败记录按最低评分维度聚类。
- 失败原因摘要展示最新失败样本数、原因组、样本数、平均分、最低分、代表样本 ID 和处理建议。
- `Failure Pattern Summary` 下方展示 `Failure Remediation Queue`，把失败原因组转成按优先级排序的修复项。
- 修复队列展示优先级、修复标题、样本数、最低分、建议动作、代表样本 ID 和复测提示。
- 支持从 `Failure Remediation Queue` 创建 Workspace 级失败修复任务。
- 相同 Workspace 下同一 `sourceRunId + clusterKey` 重复创建时返回已有任务，避免重复待办。
- 页面展示 `Remediation Tasks`，可查看任务标题、优先级、当前状态、样本数和原因组。
- 页面支持将失败修复任务从 `open` 标记为 `in_progress`，再标记为 `done`。
- `done` 状态的修复任务支持发起复测，后端会用来源 Run 的同一 Rubric 和任务代表样本创建新的 Regression Run。
- 复测 Run ID 会写回 Remediation Task；已完成且已有复测时重复复测返回已有 Run，不重复创建。
- 复测失败时任务会自动从 `done` 回流为 `in_progress`，并写入 `retest_failed` 与 `status_change` 处理记录。
- 回流后的任务再次标记为 `done` 时，会清理旧失败复测引用，允许发起新一轮复测。
- 任务卡展示复测 Run ID、通过率、失败样本数和复测失败回流状态。
- Remediation Task 支持负责人、截止时间和逾期状态。
- 新创建的修复任务由前端带默认负责人和 7 天后截止时间，后端以当前用户作为负责人兜底。
- `GET /remediation-tasks` 支持按 `owner`、`priority` 和 `overdue` 查询参数筛选。
- `Remediation Tasks` 区域展示负责人筛选、优先级筛选和逾期筛选。
- Remediation Task 支持处理活动记录，包含评论和状态变化。
- `POST /remediation-tasks/{taskId}/activities` 可创建评论并保存附件引用。
- 状态流转会自动写入 `status_change` 处理记录。
- `Remediation Tasks` 任务卡展示处理时间线和评论提交表单。
- 页面展示 `Evaluation Loop Board`，从失败原因组、Remediation Task、复测 Run 和未关闭风险派生闭环指标。
- 闭环看板展示失败原因组数、修复任务数、未关闭风险数、已复测任务数、最近复测通过率和下一步建议。
- V0.10J 看板为前端派生视图，不新增后端接口。
- 当前确定性评分器仍为默认评分器；LLM Judge 已有可注入网关合约和 ModelGateway JSON 解析骨架。

后端 API：

```text
GET /api/workspaces/{workspace_id}/evaluations/overview
GET /api/workspaces/{workspace_id}/evaluations/sample-sets
POST /api/workspaces/{workspace_id}/evaluations/sample-sets
POST /api/workspaces/{workspace_id}/evaluations/sample-sets/{sample_set_id}/samples
GET /api/workspaces/{workspace_id}/evaluations/rubrics
POST /api/workspaces/{workspace_id}/evaluations/rubrics
PATCH /api/workspaces/{workspace_id}/evaluations/rubrics/{rubric_id}
GET /api/workspaces/{workspace_id}/evaluations/rubrics/{rubric_id}/versions
POST /api/workspaces/{workspace_id}/evaluations/rubrics/{rubric_id}/publish
POST /api/workspaces/{workspace_id}/evaluations/rubrics/{rubric_id}/deactivate
POST /api/workspaces/{workspace_id}/evaluations/rubrics/{rubric_id}/evaluate
GET /api/workspaces/{workspace_id}/evaluations/records
GET /api/workspaces/{workspace_id}/evaluations/regression-runs
GET /api/workspaces/{workspace_id}/evaluations/regression-runs/{run_id}
POST /api/workspaces/{workspace_id}/evaluations/regression-runs
GET /api/workspaces/{workspace_id}/evaluations/remediation-tasks
POST /api/workspaces/{workspace_id}/evaluations/remediation-tasks
PATCH /api/workspaces/{workspace_id}/evaluations/remediation-tasks/{task_id}
POST /api/workspaces/{workspace_id}/evaluations/remediation-tasks/{task_id}/retest
```

未实现：

- 更深层的 LLM Judge 一致性评估和成本统计。
- Golden Set 样本导入、导出、版本对比和停用。
- 定时调度、常驻后台 worker、Run 取消、Run 重试和异步回归任务。
- 真正的数据库行级并发锁、失败重试退避、独立死信队列运营详情页和手动重投操作。
- 评价一致性校准。
- 修复任务的负责人、截止时间、评论、通知、自动复测和复测失败自动重开。

## 9. 运行中心

文件：`src/pages/Runs.tsx`

实现：

- 运行实例列表。
- 点击切换当前实例。
- 状态和进度。
- 总耗时、得分和成本。
- 节点执行时间线。
- 最终产出、模型、Token 和节点重试次数。
- 从 FastAPI 读取持久化 Run 与 NodeRun。

运行实例选择逻辑：

```text
点击运行实例
→ setSelectedId
→ 从 API 返回的 Run 列表寻找对应对象
→ 右侧详情重新渲染
```

未实现：

- WebSocket/SSE 实时推送。
- 日志查询。
- 真实暂停、终止和重跑。
- Trace。
- 运行回放。

## 9A. 运行观测

文件：`src/pages/Observability.tsx`

实现：

- Workspace 级运行概览。
- 总运行、失败运行、人工介入、恢复失败、平均耗时、Token 和成本摘要。
- 风险优先列表，优先展示失败、等待人工处理和恢复失败运行。
- 最近运行列表。
- 点击运行后加载节点级排障详情。
- 支持运行状态、工作流名称和风险等级筛选。
- 筛选条件与当前运行通过 URL query 同步，便于刷新保留和分享排障视图。
- 运行详情展示 `Trace ID`，节点执行链路展示 `Span` 与父 `Span`。
- 运行概览与详情返回失败原因分类、失败原因标签和排障建议。
- 运行观测页支持按失败原因筛选，并通过 URL query `failure` 同步。
- 风险卡片、最近运行列表和运行详情会展示失败原因；详情处理建议区展示具体排障建议。
- 运行观测概览返回 `alerts`，包含由运行风险投影出的页面内告警和已有 NotificationOutbox SLA 通知。
- 运行观测页展示“告警 Outbox”面板，告警会跟随当前运行筛选条件变化。
- 旧运行数据在读取观测详情时会懒回填轻量 Trace/Span 字段。
- 审计事件会挂到同一 Trace，并尽量关联到对应 Human Task 节点 Span。
- 运行详情会返回统一 `executionEvents`，覆盖 Workflow Run、Node Run、Human Task 和 Audit Event。
- Workspace 级执行事件查询支持 `runId` 与 `traceId` 过滤，并把修复任务、复测 Run 和复测失败活动映射到 `evaluation-{sourceRunId}` 合成 Trace。
- 详情展示当前处理建议、输入/结果、节点执行链路、人工审核任务和审计事件。
- 无运行数据时提示先发布并运行工作流。
- 状态文案通过 `displayStatus` 规整历史乱码状态。
- 人工 SLA 运营区块展示活跃任务、待认领、审核中、即将到期、已逾期、已升级和恢复失败。
- 支持按 Reviewer 和审核组过滤 Human Task SLA 风险。
- SLA 风险项可跳转到人工审核页，并携带 `taskId` 查询参数。
- 成本与模型调用区块展示运行次数、总 Token、Prompt Token、Completion Token 和累计成本。
- 支持按工作流和模型聚合 Token 与成本。
- 模型单价未配置时明确提示“成本单价未配置”，不把 `$0.0000` 伪装成真实成本。
- 执行队列运营区块展示 `execution_jobs` 的排队中、运行中、已完成和死信数量。
- 队列任务卡展示状态、Run/Workflow 摘要、尝试次数、最大尝试次数、锁持有者、租约到期和错误原因。
- 死信任务卡展示“重新入队”按钮，点击后调用 requeue 接口并刷新队列。
- 可取消队列任务卡展示“取消任务”按钮，点击后调用 cancel 接口并刷新队列。

后端 API：

```text
GET /api/workspaces/{workspace_id}/observability/overview
GET /api/workspaces/{workspace_id}/observability/runs/{run_id}
GET /api/workspaces/{workspace_id}/observability/execution-events
GET /api/workspaces/{workspace_id}/observability/human-sla
GET /api/workspaces/{workspace_id}/observability/cost-usage
GET /api/workspaces/{workspace_id}/execution-jobs
POST /api/workspaces/{workspace_id}/execution-jobs/{job_id}/requeue
POST /api/workspaces/{workspace_id}/execution-jobs/{job_id}/cancel
```

未实现：

- 外部观测栈接入。
- 跨服务分布式 Trace 采集。
- 外部主动告警通知发送器。
- 预算审批、成本告警和成本治理详情页。
- 操作系统级 worker 服务、独立队列运营详情页、批量重投、释放租约、重投原因审计和取消原因审计。

## 10. 成员与权限

文件：`src/pages/Members.tsx`

实现：

- 展示 Workspace 成员、平台角色、User 状态、Membership 状态和最近登录时间。
- 支持邀请成员、重发邀请、撤销邀请和复制一次性激活链接。
- 支持更新成员平台角色、停用/启用 Membership、停用/启用 User。
- 支持为成员保存或撤销 Reviewer 资格。
- 页面顶部提供当前账号 Reviewer 快捷绑定入口，便于验收人工审核闭环。
- Reviewer 资格更新后会广播刷新事件，人工审核页可同步更新当前账号资格。

未实现：

- 企业通讯录同步。
- 角色批量管理。
- 成员搜索、分页和审计导出。

## 11. 人工协作与反馈闭环

文件：`src/pages/Reviews.tsx`

实现：

- 三栏审核工作台：队列、产出物操作区、任务上下文与时间线。
- 按状态、审核人、审核组和 SLA 查询或筛选任务。
- 查询本地 Reviewer 与 ReviewGroup 目录。
- 指定审核人、组内认领、轮询分配和任务转交。
- 任一通过、全员通过和 N 人通过三种会签策略。
- 通过、驳回、修改后通过和退回重跑四种决定。
- 审核原因必填、重复决定冲突和终态保护。
- Human 节点暂停 Workflow Run，决定完成后幂等恢复、重跑或终止。
- 修改后通过创建不可变 ArtifactVersion 和统一 Diff。
- 可单独重试失败的恢复请求。
- SLA 正常、即将到期、已逾期和已升级状态。
- 到期提醒、升级通知写入 NotificationOutbox，不发送外部消息。
- 完整审计时间线。
- 人工修改生成 FeedbackCandidate，专家可确认唯一 Golden Sample。
- 导航角标显示未终结 Human Task 数量。
- 移动端使用分段视图切换队列、审核和上下文。
- 有 Human Task 时，审核区展示当前任务权限，解释按钮可用或禁用的原因。
- V0.7B 首个切片增加审核概览：待处理任务、我的参与范围、SLA 风险和待确认反馈。
- 无 Human Task 时，页面解释任务来自工作流 Human 节点，并提供进入工作流编排和成员与权限的入口。
- 无 Human Task 时，页面提供 3 步验收路径：配置 Human 节点并发布、运行至需介入、回到人工审核提交决定。
- 无 Human Task 时，页面展示验收诊断：当前账号、Reviewer 资格、人工任务数量、最近运行状态和下一步建议。
- 队列状态筛选覆盖待认领、审核中、恢复失败、已通过、修改后通过、已驳回和已退回。
- 历史 SLA 乱码状态在队列、筛选和详情区会规整显示为正常、即将到期、已逾期或已升级。
- 新产生的 SLA 状态由后端写入正常中文，不再继续产生历史乱码。
- 筛选无结果时显示可操作提示，并支持一键清空筛选。
- 工作流运行返回“需介入”时，运行弹窗提示工作流已暂停在人工审核节点，并提供进入人工审核和运行中心的入口。
- 运行中心展示“需介入”运行时，提示等待人工审核，并提供进入人工审核的入口。
- 人工审核页支持 `/reviews?taskId=...` 深链，来自运行观测的任务链接会自动选中对应 Human Task。

未实现：

- 登录、真实用户身份和完整 RBAC。
- 与企业通讯录同步 Reviewer/ReviewGroup。
- 后台 SLA 定时扫描；V0.6 在读取和操作任务时刷新 SLA。
- 飞书等外部提醒发送；V0.6 仅持久化 Outbox。
- Golden Sample 的评估集管理、回归执行和自动训练流水线。
- JSON 字段级可视化 Diff；当前工作台以统一文本 Diff 为主。
- 人工审核页面不会创建演示任务；正式 Human Task 仍由工作流运行到 Human 节点时产生。

## 12. 运营总览

文件：`src/pages/Dashboard.tsx`

实现：

- 六项运营指标。
- 自动完成率柱状图。
- 异常和人工任务摘要。
- 最近运行表格。

柱状图是 CSS 高度图，不是图表库生成。

后续建议改用 Apache ECharts，并从运营指标 API 读取数据。

## 13. 样式系统

文件：`src/index.css`

当前采用单文件原生 CSS，包含：

- 颜色变量。
- 字体变量。
- 布局。
- 导航。
- 表格。
- 卡片和面板。
- 状态徽标。
- React Flow 节点。
- 移动端媒体查询。

当前设计方向：

- 平衡触感 Soft UI。
- 雾蓝灰同材质背景。
- 浅色悬浮图标导航。
- 面板使用克制的外凸阴影。
- 输入框、选中导航和按下状态使用内凹阴影。
- 雾蓝表示主操作、选中和运行状态。
- 珊瑚表示人工介入、风险和失败。
- 表格保留高信息密度和轻分隔线。
- 工作流节点采用统一纯材质，不使用类型色边。

当前 CSS 适合原型。进入多人开发后建议拆成：

```text
styles/
├─ tokens.css
├─ reset.css
├─ layout.css
└─ components/
```

也可以引入 CSS Modules，但不建议为了技术统一直接重写现有样式。

## 14. 当前状态管理

没有引入 Redux、Zustand 或 TanStack Query。

当前只使用 React 内置状态：

- `useState`。
- `useMemo`。
- React Flow 的节点和边状态 Hook。

这是有意为原型控制复杂度。

进入后端阶段后建议：

```text
服务器数据：TanStack Query
画布编辑状态：Zustand
表单状态：React Hook Form
Schema 校验：Zod
```

## 15. 当前构建和质量检查

### 开发

```powershell
npm run dev
```

### 静态检查

```powershell
npm run lint
```

使用 Oxlint。

### 生产构建

```powershell
npm run build
```

执行：

```text
TypeScript 编译检查
→ Vite 生产打包
```

当前自动化测试包括：

- Vitest + Testing Library：API 客户端、应用外壳、Agent、工作流配置、运行中心和人工审核工作台。
- Pytest：字段校验、Agent 生命周期、工作流 DAG、Human Task、分配会签、恢复执行、SLA、反馈候选和 Golden Sample。
- 浏览器验收：关键页面桌面端与移动端布局、真实 API 数据链路和控制台错误检查。

## 16. 当前依赖

生产依赖：

- React。
- React DOM。
- React Router DOM。
- React Flow。
- Lucide React。

开发依赖：

- TypeScript。
- Vite。
- Vite React 插件。
- React/Node 类型定义。
- Oxlint。

当前没有：

- UI 组件框架。
- 图表库。
- 第三方 HTTP 客户端，当前使用原生 `fetch`。
- 状态管理库。
- AI SDK。

后端新增：

- FastAPI。
- Pydantic。
- SQLAlchemy。
- SQLite，支持通过 `DATABASE_URL` 切换 PostgreSQL。

当前已引入轻量 `execution_jobs` 队列骨架、失败重新入队、`dead_letter` 终态、worker 租约、heartbeat、观测页队列运营卡片、死信手动重新入队、主动取消、常驻 worker 代码骨架和 worker CLI 入口，但仍未引入 Docker/操作系统级 worker 服务、真正的数据库行级并发锁、指数退避、独立队列运营详情页和外部通知 SDK。

## 17. 当前版本验证记录

已经完成：

- `apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q`：后端 180 项测试通过。
- `npm test -- --run`：27 个前端测试文件、101 项测试通过。
- `npm run lint`：Oxlint 通过。
- `npm run build`：TypeScript 编译与 Vite 生产构建通过。
- Human 节点发布前校验覆盖分配方式、会签人数和 SLA 参数。
- 旧 V0.5/V0.6 SQLite 表可增量补列，历史 Human Task 与 Review Decision 测试行保持可读。
- 真实 DeepSeek 调用生成 Artifact，Workflow Run 在 Human 节点进入等待审核。
- 桌面端完成认领、原因必填、修改后通过、Artifact v2、Diff、工作流恢复和审计时间线验证。
- 修改后通过生成 FeedbackCandidate，质量专家确认后创建唯一 Golden Sample。
- 移动端完成队列、审核、上下文分段切换和普通通过路径。
- 终态后导航 Human Task 角标无需刷新即可更新。
- `1440×900` 工作流编排和审核工作台无页面横向溢出。
- 移动端审核工作台无页面横向溢出，长产出物可读，底部决定按钮可操作。
- 工作流 Human 节点配置面板展示分配、审核组、会签、SLA 和升级组。
- 工作流新建后恢复 3 个默认节点和 2 条默认连线，新增节点后真实拖拽可创建第 3 条连线。
- `390×844` 下节点库横向滚动，手动触发和流程完成节点均可访问，页面无整体横向溢出。
- 浏览器验收期间控制台无 warning 或 error。
- V0.7B 人工审核页当前任务权限状态卡完成浏览器验收：无权限时展示“不能处理”、原因和下一步，并禁用认领与审核决定按钮。
- V0.7B 修复 Human 节点 `direct_reviewer` 与后端校验不一致的问题，指定审核人的参与快照可正确进入 Human Task 并完成认领。
- V0.8A 完成运行观测页浏览器验收：页面可打开，真实风险数据可渲染，风险状态规整为“等待审核”，浏览器日志无 error/warn。
- V0.8B 完成运行观测筛选测试：运行状态、工作流名称、风险等级可从 URL 初始化，筛选变更和选中运行会同步 URL query。
- V0.8D 完成 Trace 骨架测试：运行详情返回 Trace ID、节点 Span、父 Span 和审计事件 Span 关联，旧 SQLite 表可补列。
- V0.8E 完成失败原因分类测试：概览与详情返回 `failureCategory`、`failureCategoryLabel` 和 `troubleshootingHint`，观测页支持失败原因筛选和 URL query 同步。
- V0.8F 完成轻量告警 Outbox 测试：观测概览返回 `alerts`，观测页展示告警 Outbox，告警随运行筛选条件变化；不发送外部通知。
- V0.8A 完成人工 SLA 运营浏览器验收：SLA 区块、Reviewer/审核组筛选器和 `/reviews?taskId=...` 跳转链接可见，浏览器日志无 error/warn。
- V0.8C 完成成本与模型调用浏览器验收：区块、未配置单价提示、按工作流聚合和按模型聚合可见，浏览器日志无 error/warn。
- V0.9A 完成评估资产概览浏览器验收：真实 API 概览区块、空状态和 Rubric 卡片可见，浏览器日志无 error/warn。
- V0.9E 完成评估记录中心自动化测试：记录列表、状态筛选、Rubric 筛选和运行后即时插入均通过。
- V0.9E 完成浏览器验收：临时账号运行一次 Rubric 评估后，历史记录即时出现；`failed` 筛选展示记录，`passed` 筛选展示空状态，Rubric 筛选恢复记录；浏览器日志无 error/warn。
- V0.9E 浏览器验收截图：`.scratch/v0.9e-evaluation-history.png`。
- V0.9F 完成评估详情自动化测试：点击“查看详情”后，弹窗展示记录 ID、待评估产出物、Rubric 快照、维度权重和维度得分。
- V0.9F 完成浏览器验收：临时账号运行一次 Rubric 评估后打开详情弹窗，确认 Rubric 快照、维度评分、待评估产出物和评分说明可见；登录后页面控制台无 error/warn。
- V0.9F 浏览器验收截图：`.scratch/v0.9f-evaluation-detail.png`。
- V0.9G 完成轻量批量回归自动化测试：输入两条回归样本后连续调用评估 API，页面展示 50% 通过率、失败样本和对应 Evaluation 记录。
- V0.9G 完成浏览器验收：临时账号在评估中心运行两条回归样本，页面展示批量结果、失败样本和 Evaluation 记录；控制台无 error/warn；验收后已清理临时账号与评估记录。
- V0.9G 浏览器验收截图：`.scratch/v0.9g-batch-regression.png`。
- V0.9H 完成 Golden Set 自动化测试：创建/查询样本集、添加样本、前端选择样本集运行批量回归，均已纳入 focused 测试。
- V0.9H 完成浏览器验收：临时账号创建样本集、加入样本、选择 Golden Set 运行批量回归成功；浏览器控制台无 error/warn；验收后已清理临时账号、样本集、样本和评估记录。
- V0.9H 浏览器验收截图：`.scratch/v0.9h-golden-set.png`。
- V0.10A 完成 Regression Run 自动化测试：后端可用 Golden Set 或手动样本创建 Regression Run，前端批量回归改为调用持久化 Run 接口并展示最近运行历史。
- V0.10A 完成浏览器验收：临时账号在评估中心输入两条手动样本运行 Regression Run 成功，刷新后 `Regression Run History` 仍展示该 Run；浏览器控制台无 error/warn。
- V0.10A 浏览器验收截图：`.scratch/v0.10a-regression-run-history.png`。
- V0.10B 完成 Regression Run 详情自动化测试：后端可按 Run ID 返回详情与关联 Evaluation 记录，前端历史区支持 Rubric/状态筛选并可打开详情弹窗。
- V0.10B 完成浏览器验收：临时账号在评估中心按 Rubric 和状态筛选 Regression Run，打开详情弹窗后可见 Run 上下文与样本级 Evaluation 明细；浏览器日志无 error/warn。
- V0.10B 浏览器验收截图：`.scratch/v0.10b-regression-run-detail.png`。
- V0.10C 完成 Regression Run 对比自动化测试：前端可选择基准 Run 与目标 Run，读取两次详情并展示通过率变化、失败样本变化和样本级状态变化。
- V0.10C 完成浏览器验收：本地验收账号创建两次 Regression Run 后，页面可选择基准/目标 Run 并展示 4 张样本变化卡；浏览器日志无 error/warn。
- V0.10C 浏览器验收截图：`.scratch/v0.10c-regression-run-comparison.png`。
- V0.10D 完成 Regression Run 趋势自动化测试：前端会根据最近多次 Run 计算最新通过率、较上次变化、平均通过率、最佳通过率和风险趋势点。
- V0.10D 完成浏览器验收：本地验收会话打开评估中心后，趋势区展示 4 个指标、4 根趋势柱和风险标记；浏览器日志无 error/warn。
- V0.10D 浏览器验收截图：`.scratch/v0.10d-regression-run-trend.png`。
- V0.10E 完成 Regression Run 洞察自动化测试：最新 Run 低于风险线且较上次下降时，页面展示质量下滑、最新通过率、较上次变化、风险 Run 数和处理建议。
- V0.10E 完成浏览器验收：本地验收会话打开评估中心后，洞察卡展示质量状态、3 个事实项和建议；浏览器日志无 error/warn。
- V0.10E 浏览器验收截图：`.scratch/v0.10e-regression-run-insight.png`。
- V0.10F 完成失败样本聚类自动化测试：最新 Run 中 3 条失败样本会按最低评分维度聚合为 Evidence 与 Actionability 两个原因组。
- V0.10F 完成真实浏览器验收：本地验收会话登录后创建 Regression Sample Set、运行 Regression Run，并在评估中心看到 `Failure Pattern Summary` 与 1 个失败原因聚类卡。
- V0.10F 浏览器验收截图：`.scratch/v0.10f-failure-pattern-summary.png`；验收结果：`.scratch/v0.10f-browser-result.json`。
- V0.10G 完成失败原因修复队列自动化测试：失败原因组会生成 `Failure Remediation Queue`，展示优先级、修复标题、复测提示和代表样本 ID。
- V0.10G 完成真实浏览器验收：本地验收会话登录后创建 Regression Sample Set、运行 Regression Run，并在评估中心看到 `Failure Remediation Queue` 与 1 个修复项。
- V0.10G 浏览器验收截图：`.scratch/v0.10g-failure-remediation-queue.png`；验收结果：`.scratch/v0.10g-browser-result.json`。
- V0.10H 完成失败修复任务 focused 自动化测试：后端支持创建、去重读取和状态更新；前端可从修复队列创建任务，并将任务标记为处理中和已完成。
- V0.10H 完成真实浏览器验收：本地登录会话在评估中心从 `Failure Remediation Queue` 创建 1 个任务，状态从 `open` 流转到 `in_progress`，再到 `done`；本次验证开始后的新增 console warning/error 为 0。
- V0.10H 浏览器验收截图：`.scratch/v0.10h-remediation-tasks.png`；验收结果：`.scratch/v0.10h-browser-result.json`。
- V0.10I 完成 focused 自动化测试：后端支持已完成修复任务发起复测、重复复测去重和未完成任务 409；前端支持任务完成后发起复测并展示复测 Run、通过率和失败数。
- V0.10I 完成真实浏览器验收：本地登录会话在评估中心点击 `发起复测` 后，任务卡展示复测 Run、通过率和失败数；本次验证期间新增 console warning/error 为 0。
- V0.10I 浏览器验收截图：`.scratch/v0.10i-remediation-retest.png`；验收结果：`.scratch/v0.10i-browser-result.json`。
- V0.10J 完成 focused 自动化测试：评估中心在任务复测后展示 `Evaluation Loop Board`，包含失败原因组、修复任务、未关闭风险、已复测、最近复测通过率和下一步建议。
- V0.10J 完成全量验证：`apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q`、`npm test -- --run`、`npm run lint`、`npm run build` 均通过。
- V0.10J 完成真实浏览器验收：评估中心可见 `Evaluation Loop Board`，本次刷新验证期间新增 console warning/error 为 0。
- V0.10J 浏览器验收截图：`.scratch/v0.10j-evaluation-loop-board.png`；验收结果：`.scratch/v0.10j-browser-result.json`。
- V0.11A 完成 focused 自动化测试：后端创建任务可保存 `owner` 和 `dueDate`，列表支持 `owner`、`priority`、`overdue` 过滤；前端任务卡展示负责人、截止时间和逾期状态，并支持三个筛选控件。
- V0.11A 完成全量验证：`apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q`、`npm test -- --run`、`npm run lint`、`npm run build` 均通过。
- V0.11A 完成真实浏览器验收：评估中心 `Remediation Tasks` 区域可见负责人筛选、优先级筛选、逾期筛选和任务卡运营字段，本次验证期间新增 console warning/error 为 0。
- V0.11A 浏览器验收截图：`.scratch/v0.11a-remediation-ownership.png`；验收结果：`.scratch/v0.11a-browser-result.json`。
- V0.11B 完成 focused 自动化测试：后端支持创建 Remediation Task 评论、保存附件引用、状态变化自动写入处理记录；前端任务卡展示处理时间线并支持提交评论。
- V0.11B 完成全量验证：`apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q`、`npm test -- --run`、`npm run lint`、`npm run build` 均通过。
- V0.11B 完成真实浏览器验收：评估中心 `Remediation Tasks` 区域可见处理时间线和评论表单，提交评论后出现正文与附件引用，本次验证期间新增 console warning/error 为 0。
- V0.11B 浏览器验收截图：`.scratch/v0.11b-remediation-activity.png`；验收结果：`.scratch/v0.11b-browser-result.json`。
- V0.11C 完成 focused 自动化测试：复测失败后 Remediation Task 自动回流为 `in_progress`，写入 `retest_failed` 与 `status_change`，再次标记完成后可重新复测；任务列表 API 会返回复测 Run 摘要。
- V0.11C 完成全量验证：`apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q`、`npm test -- --run`、`npm run lint`、`npm run build` 均通过。
- V0.11C 完成真实浏览器验收：评估中心点击“发起复测”后，任务卡显示“复测失败已回流”，状态回流为 `in_progress`，Evaluation Loop Board 显示“未关闭风险 1”；刷新后复测摘要和回流状态仍保留，本次新起点后 console warning/error 为 0。
- V0.11C 浏览器验收截图：`.scratch/v0.11c-retest-loopback.png`；验收结果：`.scratch/v0.11c-browser-result.json`。
- V0.11D 完成 focused 自动化测试：运行详情返回 `executionEvents`，覆盖 `workflow_run`、`node_run`、`human_task`、`audit_event` 并按时间排序；前端运行观测详情展示“执行事件流”。
- V0.11D 完成全量验证：`apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q`、`npm test -- --run`、`npm run lint`、`npm run build` 均通过。
- V0.11D 完成真实浏览器验收：运行观测详情可见“执行事件流”，包含 workflow/node/human/audit 事件、Trace 与 Span；本次新起点后 console warning/error 为 0。
- V0.11D 浏览器验收截图：`.scratch/v0.11d-execution-event-stream.png`；验收结果：`.scratch/v0.11d-browser-result.json`。
- V0.12A 完成 Runtime RED/GREEN 测试：`test_agent_runtime.py` 首次因 `app.agent_runtime` 不存在失败，随后 Runtime 成功与失败测试通过。
- V0.12A focused 验证通过：Runtime 两条测试、Agent 直接测试运行和工作流 Agent 节点运行共 4 条通过。
- V0.12A 后端全量验证通过：`apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q`。
- V0.12B 完成 Tool / Skill 资产库后端 RED/GREEN 测试：`test_tool_skill_assets_api.py` 首次因 `/asset-library` 路由不存在失败，随后创建、列表、重复名、Workspace 隔离和观察者禁止写入 4 条测试通过。
- V0.12B 完成 Agent 资产授权 RED/GREEN 测试：首次因任意字符串工具可保存、禁用资产仍可发布失败，随后 Agent 只能绑定已启用资产且发布时会重新校验。
- V0.12B 完成 Tool / Skill 调用日志骨架 RED/GREEN 测试：首次因调用日志模型不存在失败，随后日志查询、过滤和 Workspace 隔离测试通过。
- V0.12B 完成全量验证：`apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q`、`npm run lint`、`npm run build` 均通过。
- V0.12C 完成 HTTP Tool 测试调用 RED/GREEN 测试：首次因 `app.tool_runtime` 不存在失败，随后成功调用日志、失败脱敏日志和非 HTTP Tool 422 三项测试通过。
- V0.12C 完成 Agent 执行工具调用 RED/GREEN 测试：首次因 Agent 运行后没有调用日志失败，随后 Agent 测试运行可写入带 `agentId`、`agentVersion`、`runId` 和 `nodeRunId` 的 HTTP Tool 调用日志。
- V0.12C 完成 Tool 调用 Trace 事件 RED/GREEN 测试：首次因运行详情缺少 `tool_skill_invocation` 事件失败，随后 Tool 调用日志可进入运行观测 `executionEvents` 并继承 NodeRun Span。
- V0.12C 完成 HTTP allowlist Gateway RED/GREEN 测试：首次因 `HttpxToolGateway` 不存在失败，随后 allowlist 拦截和 MockTransport 成功调用通过。
- V0.12C 完成 MCP 测试调用 RED/GREEN 测试：首次因路由不支持 MCP 和测试客户端不支持 `mcp_gateway` 失败，随后 MCP Tool 测试调用可通过可注入网关写入调用日志。
- V0.12C 完成相关回归验证：`apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_tool_runtime_api.py apps/api/tests/test_agent_runtime.py apps/api/tests/test_execution_api.py apps/api/tests/test_agent_lifecycle_api.py apps/api/tests/test_tool_skill_assets_api.py apps/api/tests/test_tool_skill_invocation_logs_api.py -q`，23 项通过。
- V0.12C 完成全量验证：`apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q` 166 项通过；`npm test -- --run` 27 个测试文件、96 项测试通过；`npm run lint` 通过；`npm run build` 通过。
- V0.12D 完成 LLM Judge RED/GREEN 测试：首次因 `app.judge_gateway` 不存在失败，随后 `judgeType=llm` 的 Rubric 可通过 Fake Judge Gateway 生成 Evaluation，并记录 evaluator 类型、模型和输入快照。
- V0.12D 完成评估中心回归验证：`apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_evaluations_api.py -q`，14 项通过。
- V0.12D 完成 ModelJudgeGateway RED/GREEN 测试：首次因 `ModelJudgeGateway` 不存在失败，随后可通过 Fake ModelGateway 解析 JSON 评分结果。
- V0.12D 完成 Judge 网关相关回归验证：`apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_judge_gateway.py apps/api/tests/test_evaluations_api.py apps/api/tests/test_model_gateway.py -q`，18 项通过。
- V0.12D 完成 Judge schema 与重试 RED/GREEN 测试：首次因 `max_attempts` 不存在失败，随后无效 JSON 可重试一次后成功，缺失维度权重会被拒绝。
- V0.12D 完成 Judge Prompt 版本 RED/GREEN 测试：首次因 `judgePromptVersion` 缺失失败，随后输入快照和系统提示词均包含 `llm-judge-v1`。
- V0.12D 完成 Rubric Judge 前端配置 RED/GREEN 测试：首次因页面缺少“评分器类型”控件失败，随后创建 LLM Judge Rubric 时可提交 `judgeType=llm` 与 `judgeModel`。
- V0.12D 完成 LLM Judge 校准概览 RED/GREEN 测试：首次因页面缺少“LLM Judge 校准”失败，随后页面可从两条 LLM Judge 记录展示 2 条样本、50% 通过率、模型和 Prompt 版本。
- V0.12D 完成全量验证：`apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q` 170 项通过；`npm test -- --run` 27 个测试文件、98 项测试通过；`npm run lint` 通过；`npm run build` 通过。
- V0.12D 完成浏览器验收：评估中心 Rubric 弹窗中“评分器类型”控件唯一；默认隐藏 Judge 模型；切换为 LLM Judge 后模型输入出现并可填写 `deepseek-v4-pro`；浏览器控制台新增 error/warn 为 0。
- V0.13A 完成异步队列 RED/GREEN 测试：首次因 `ExecutionJobRecord` 不存在失败，随后 `asyncMode=true` 可创建 `排队中` Run 与 `queued` job，不立即调用模型，`POST /execution-jobs/next` 可领取并执行为 `已完成`。
- V0.13A 完成执行相关回归验证：`apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_execution_api.py apps/api/tests/test_human_workflow_execution.py apps/api/tests/test_human_task_api.py apps/api/tests/test_observability_api.py -q`，42 项通过。
- V0.13A 完成全量验证：`apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q` 后端 172 项通过；`npm test -- --run` 27 个测试文件、98 项测试通过；`npm run lint` 通过；`npm run build` 通过。
- V0.13B 完成队列失败重试和死信 RED/GREEN 测试：首次因失败 job 直接 `failed` 且后续领取 404 失败，随后失败 job 可重新入队并在下一次领取后成功；达到 3 次失败后进入 `dead_letter`。
- V0.13B 完成执行相关回归验证：`apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_execution_api.py apps/api/tests/test_human_workflow_execution.py apps/api/tests/test_human_task_api.py apps/api/tests/test_observability_api.py -q`，44 项通过。
- V0.13B 完成全量验证：`apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q` 后端 174 项通过；`npm test -- --run` 27 个测试文件、98 项测试通过；`npm run lint` 通过；`npm run build` 通过。
- V0.13C 完成 worker 租约和 heartbeat RED/GREEN 测试：首次因过期 `running` job 无法接管、heartbeat 路由不存在失败，随后租约未过期时其他 worker 领取 404，租约过期后可接管执行，当前 worker 可通过 heartbeat 延长租约。
- V0.13C 完成执行相关回归验证：`apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_execution_api.py apps/api/tests/test_human_workflow_execution.py apps/api/tests/test_human_task_api.py apps/api/tests/test_observability_api.py -q`，46 项通过。
- V0.13C 完成全量验证：`apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q` 后端 176 项通过；`npm test -- --run` 27 个测试文件、98 项测试通过；`npm run lint` 通过；`npm run build` 通过。
- V0.13D 完成执行队列运营入口 RED/GREEN 测试：首次因 `GET /execution-jobs` 404 失败，随后接口支持状态筛选并返回运营字段；运行观测页展示执行队列运营卡片、状态计数、死信任务和错误原因。
- V0.13D 完成 focused 验证：`apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_execution_api.py::test_execution_jobs_list_supports_status_filter_and_operational_fields -q` 1 项通过；`npm test -- --run src/api/execution.test.ts src/pages/Observability.test.tsx` 2 个测试文件、9 项通过。
- V0.13D 完成全量验证：`apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q` 后端 177 项通过；`npm test -- --run` 27 个测试文件、99 项测试通过；`npm run lint` 通过；`npm run build` 通过。
- V0.13E 完成死信重新入队 RED/GREEN 测试：首次因 `POST /execution-jobs/{jobId}/requeue` 404 失败，随后 dead letter job 可重置为 `queued`，关联 Run 回到 `排队中 / 等待重投`；观测页死信卡片可点击“重新入队”并调用接口。
- V0.13E 完成 focused 验证：`apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_execution_api.py::test_dead_letter_execution_job_can_be_requeued -q` 1 项通过；`npm test -- --run src/api/execution.test.ts src/pages/Observability.test.tsx` 2 个测试文件、10 项通过。
- V0.13E 完成全量验证：`apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q` 后端 178 项通过；`npm test -- --run` 27 个测试文件、100 项测试通过；`npm run lint` 通过；`npm run build` 通过。
- V0.13F 完成主动取消 RED/GREEN 测试：首次因 `POST /execution-jobs/{jobId}/cancel` 404 失败，随后 queued job 可取消为 `canceled`，关联 Run 回到 `已取消`，worker 不再领取该 job；观测页队列卡片可点击“取消任务”并调用接口。
- V0.13F 完成 focused 验证：`apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_execution_api.py::test_execution_job_can_be_canceled_before_worker_claims_it -q` 1 项通过；`npm test -- --run src/api/execution.test.ts src/pages/Observability.test.tsx` 2 个测试文件、11 项通过。
- V0.13F 完成全量验证：`apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q` 后端 179 项通过；`npm test -- --run` 27 个测试文件、101 项测试通过；`npm run lint` 通过；`npm run build` 通过。
- V0.13G 完成常驻 worker 骨架 RED/GREEN 测试：首次因 `app.worker` 不存在失败，随后 `ExecutionQueueWorker` 可处理 queued workflow run、写入 worker id、运行完成并在空队列时退出。
- V0.13G 完成 focused 验证：`apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_execution_worker.py -q` 1 项通过。
- V0.13G 完成全量验证：`apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q` 后端 180 项通过；`npm test -- --run` 27 个测试文件、101 项测试通过；`npm run lint` 通过；`npm run build` 通过。
- V0.13H 完成 worker CLI 启动入口验证：`apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_execution_worker.py -q` 2 项通过；`cd apps/api; .\.venv\Scripts\python.exe -m app.worker --help` 可正常输出参数帮助。
- V0.13H 完成全量验证：`apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q` 后端 181 项测试通过；`npm test -- --run` 27 个测试文件、101 项测试通过；`npm run lint` 通过；`npm run build` 通过；`git diff --check` 仅有 Windows 换行提示。

验证时没有发现浏览器控制台错误。

当前机器未安装 Docker，因此 PostgreSQL Compose 配置与跨数据库正式迁移工具尚未进行容器运行验证；V0.6 的轻量增量迁移仅针对默认 SQLite。

## 18. 下一步代码改造

建议按以下顺序改造当前代码：

1. V0.7 增加登录、用户身份、组织与 RBAC，将 Reviewer 绑定真实账号。
2. 增加工作流输入输出映射、并行汇聚、条件路由和子流程契约。
3. 继续 V0.13 执行系统生产化：补 Docker/操作系统级 worker 服务、真正的数据库行级并发锁、指数退避、独立队列运营详情页、批量重投、取消/重投原因审计和实时事件推送，并评估 Temporal Signal/Update。
4. 将 Rubric、Golden Sample、评价器和回归任务接入真实评估闭环。
5. 增加 NotificationOutbox 消费器和飞书通知适配器。
6. 在具备 Docker 的环境验证 PostgreSQL Compose 与数据库迁移流程。

完整版本路线、开源工具说明和从当前版本到 V1.0 的逐步落地清单见：

[项目建设蓝图](PROJECT_MASTER_PLAN.md)
