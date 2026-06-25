# V0.6 人工协作与反馈闭环设计

## 1. 背景

ARC.ONE V0.5 已具备真实 Agent 与工作流执行闭环，并能在质量门禁未通过时创建基础人工审核记录。V0.6 将人工审核从简单记录升级为独立业务领域，使工作流能够在人工节点暂停、协作审核、恢复执行，并沉淀可追溯的反馈样本。

本设计采用“独立 `HumanTask` 领域 + 可恢复执行服务”方案。V0.6 不引入 Temporal，但通过稳定的领域边界和恢复接口，为后续迁移到 Temporal Signal 或 Update 保留空间。

## 2. 目标

V0.6 必须实现：

1. 工作流进入人工审核节点后暂停，并持久化恢复位置。
2. 支持审核人、审核组、角色、轮询分配、认领和转交。
3. 支持任一通过、全员会签和 N 人通过三种审批策略。
4. 支持通过、驳回、修改后通过、退回重跑四种决定。
5. 支持 SLA 状态、提醒记录和超时升级。
6. 保存人工修改前后版本及结构化 Diff。
7. 将人工修改沉淀为反馈候选，经专家确认后进入 Golden Set。
8. 所有关键操作均具备操作者、理由、时间和状态变化记录。

## 3. 非目标

V0.6 不包含：

- 登录、单点登录和完整 RBAC；这些能力属于 V0.7。
- Temporal、Celery 或其他后台任务调度器。
- 真实飞书消息或飞书任务发送。
- 自动将普通审批结果写入 Golden Set。
- 通用 Rubric 设计器或自动训练流水线。
- 对现有执行引擎进行无关重构。

## 4. 总体架构

### 4.1 组件

#### HumanTaskService

负责人工任务的创建、分配、认领、转交、决策、会签进度和 SLA 刷新。该服务是人工协作规则的唯一入口。

#### WorkflowResumeService

负责读取持久化执行游标，并根据最终审核结果执行以下动作：

- 通过：从人工节点的下游继续执行。
- 修改后通过：使用新的 Artifact 版本继续执行。
- 退回重跑：从原始 Agent 节点重新执行。
- 驳回：终止当前 Workflow Run。

该服务必须提供幂等恢复接口。同一最终决定不得重复恢复工作流。

#### FeedbackService

负责从人工修改生成 `FeedbackCandidate`，以及在专家二次确认后创建不可变的 `GoldenSample`。

#### NotificationPort

定义提醒与升级通知接口。V0.6 的实现只写入 `NotificationOutbox`，不调用外部消息服务。

### 4.2 依赖关系

```text
Review Workbench
    -> HumanTask API
        -> HumanTaskService
            -> HumanTask / ReviewDecision / AuditEvent
            -> WorkflowResumeService
                -> WorkflowRun / NodeRun / ArtifactVersion
            -> FeedbackService
                -> FeedbackCandidate / GoldenSample
            -> NotificationPort
                -> NotificationOutbox
```

领域服务通过明确接口协作，不由 API 路由直接修改工作流或反馈记录。

## 5. 领域模型

### 5.1 HumanTask

人工审核任务，至少包含：

- `id`
- `workflow_run_id`
- `node_run_id`
- `source_node_id`
- `artifact_version_id`
- `status`
- `assignment_type`
- `assignee_reviewer_id`
- `assignee_group_id`
- `review_policy`
- `required_approvals`
- `due_at`
- `escalation_at`
- `sla_status`
- `escalation_group_id`
- `resume_status`
- `created_at`
- `updated_at`

任务状态：

```text
PENDING
CLAIMED
IN_REVIEW
APPROVED
MODIFIED_APPROVED
RERUN_REQUESTED
REJECTED
RESUME_FAILED
```

`APPROVED`、`MODIFIED_APPROVED`、`RERUN_REQUESTED` 和 `REJECTED` 是业务终态。`RESUME_FAILED` 表示审核决定已形成，但恢复执行失败；重试只能恢复执行，不得重新生成审核决定。

### 5.2 Reviewer 与 ReviewGroup

`Reviewer` 表示可被分配人工任务的人员目录项，包含姓名、角色、启用状态和专家标识。

`ReviewGroup` 表示审核组，包含成员、组内角色、轮询游标和是否可作为升级组。V0.6 使用本地目录，不与身份系统绑定。

分配方式：

- 指定审核人。
- 指定审核组，由成员认领。
- 指定审核组，按轮询规则分配。

任务允许认领和转交。每次分配变化必须写入审计事件。

创建需要多人参与的任务时，必须保存本次任务的审核人快照。审核组后续增删成员不改变已经创建任务的 `ALL` 分母或 `THRESHOLD` 候选范围。

### 5.3 ReviewPolicy

支持三种策略：

- `ANY_ONE`：任意一名有效审核人通过即满足策略。
- `ALL`：所有指定审核人通过才满足策略。
- `THRESHOLD`：达到 `required_approvals` 人通过才满足策略。

任何策略下，只要出现一条有效拒绝决定，立即进入拒绝路径，不再等待其他审核人。

同一审核人对同一任务只能保留一条有效决定。任务终态后不再接受新决定。

`APPROVE` 与 `MODIFY_AND_APPROVE` 都计入通过人数。出现 `MODIFY_AND_APPROVE` 后，新 Artifact 版本成为该任务后续审核的候选输入版本；后续审核人必须针对该版本作出决定。若再次修改，则继续创建新版本并更新候选输入版本。

`REJECT` 与 `RETURN_FOR_RERUN` 都是立即决定：前者立即终止当前 Workflow Run，后者立即结束当前会签并从原 Agent 节点重跑。

### 5.4 ReviewDecision

每次审核决定包含：

- 审核任务
- 操作者
- 决定类型
- 原因
- 标签
- 修改后的 Artifact 版本，可为空
- 决定时间
- 幂等键

决定类型：

- `APPROVE`
- `REJECT`
- `MODIFY_AND_APPROVE`
- `RETURN_FOR_RERUN`

`MODIFY_AND_APPROVE` 必须同时创建新的不可变 Artifact 版本。

### 5.5 ArtifactVersion 与 ArtifactDiff

人工编辑不覆盖原始产物，而是创建新的 `ArtifactVersion`。版本记录来源版本、编辑者和创建时间。

`ArtifactDiff` 保存原版本与人工版本之间的结构化变化。文本产物至少支持逐行 Diff；结构化 JSON 产物保留字段级变化。无法结构化比较时，保存完整前后文本和统一 Diff。

### 5.6 FeedbackCandidate 与 GoldenSample

只有 `MODIFY_AND_APPROVE` 会自动创建 `FeedbackCandidate`。候选记录包含：

- 原始输出版本
- 人工修改版本
- Diff
- 修改原因
- 标签
- 来源 Agent、工作流、节点和运行
- 创建者与创建时间

普通通过不会创建候选样本。

只有具备专家标识的审核人执行二次确认后，才能从候选创建不可变 `GoldenSample`。同一候选只能生成一个有效 Golden Sample，重复确认必须幂等。

### 5.7 AuditEvent

审计事件覆盖：

- 创建与分配
- 认领与转交
- SLA 即将到期
- 逾期与升级
- 人工编辑
- 审核决定
- 会签策略满足
- 工作流恢复、重跑、终止与恢复失败
- Golden Sample 确认

事件必须记录操作者、原因、前后状态、关联对象和发生时间。系统触发事件使用明确的系统操作者标识。

### 5.8 NotificationOutbox

Outbox 记录提醒和升级事件，至少包含事件类型、接收人或审核组、关联任务、载荷、创建时间和发送状态。

V0.6 不发送外部消息，发送状态保持待处理；后续飞书适配器通过 `NotificationPort` 消费。

## 6. 工作流暂停与恢复

### 6.1 暂停

执行引擎进入 Human Review 节点时：

1. 保存当前执行游标和上游 Artifact 版本。
2. 创建 `HumanTask`。
3. 将对应 `NodeRun` 标记为等待审核。
4. 将 `WorkflowRun` 标记为 `WAITING_REVIEW`。
5. 返回当前运行快照，不继续执行下游节点。

执行游标必须能够定位当前人工节点、来源 Agent 节点和后续待执行节点。

### 6.2 恢复

审批策略满足后，`WorkflowResumeService` 在同一业务操作中登记恢复请求，并执行：

- `APPROVE`：沿当前人工节点的下游继续。
- `MODIFY_AND_APPROVE`：将新 Artifact 版本作为下游输入并继续。
- `RETURN_FOR_RERUN`：从 `source_node_id` 指向的原 Agent 节点重新执行，后续节点随之重算。
- `REJECT`：将人工节点、运行和未执行下游节点置为终止状态。

恢复操作使用任务 ID 与最终决定 ID 组成幂等边界。重复请求返回已有结果。

恢复失败时：

- 审核决定与 Artifact 新版本保留。
- HumanTask 标记为 `RESUME_FAILED`。
- 记录失败原因和审计事件。
- 允许仅重试恢复阶段。

## 7. SLA 与升级

任务创建时计算：

- `due_at`：审核截止时间。
- `escalation_at`：自动升级时间。

V0.6 不运行后台调度器。以下操作会调用统一的 `refresh_sla(task, now)`：

- 查询审核队列。
- 查询审核任务详情。
- 认领、转交或提交决定。

SLA 状态：

- `NORMAL`
- `DUE_SOON`
- `OVERDUE`
- `ESCALATED`

达到提醒阈值时写入一次提醒 AuditEvent 与 NotificationOutbox。达到 `escalation_at` 后，将未完成任务转交至升级审核组，状态改为 `ESCALATED`，并写入完整事件记录。

所有 SLA 计算使用可注入时钟，保证测试可重复。重复刷新不得生成重复提醒或重复升级记录。

## 8. API 设计

### 8.1 队列与详情

- `GET /human-tasks`
  - 支持状态、审核人、审核组、SLA 状态筛选。
  - 返回前刷新命中任务的 SLA。
- `GET /human-tasks/{task_id}`
  - 返回任务、分配信息、产物版本、Diff、会签进度、运行上下文和审计摘要。

### 8.2 协作操作

- `POST /human-tasks/{task_id}/claim`
- `POST /human-tasks/{task_id}/transfer`
- `POST /human-tasks/{task_id}/decisions`

决定请求包含决定类型、原因、标签、修改内容和幂等键。只有 `MODIFY_AND_APPROVE` 接受修改内容。

### 8.3 反馈操作

- `GET /feedback-candidates`
- `GET /feedback-candidates/{candidate_id}`
- `POST /feedback-candidates/{candidate_id}/confirm`

确认请求包含专家审核人、确认理由和幂等键。

### 8.4 错误语义

- `400 Bad Request`：参数或状态组合无效。
- `404 Not Found`：任务、审核人、审核组或候选不存在。
- `409 Conflict`：任务已终结、重复决定、版本过期、已被他人认领或恢复状态冲突。
- `422 Unprocessable Entity`：会签策略配置或修改内容不满足业务规则。
- `500 Internal Server Error`：不可恢复的数据错误。

外部模型或执行恢复失败不得泄露密钥、请求头或环境变量。

## 9. 前端设计

V0.6 使用三栏审核工作台：

### 左栏：任务队列

- 状态、审核组、审核人和 SLA 筛选。
- 显示待认领、处理中、即将到期、逾期和升级状态。
- 支持认领与转交。

### 中栏：产物审核

- 展示原始 Artifact。
- 支持审核模式与编辑模式切换。
- 编辑后展示前后 Diff。
- 提供通过、驳回、修改后通过和退回重跑操作。
- 必填原因缺失、版本冲突和无权操作必须给出就地错误提示。

### 右栏：上下文

- 运行和节点上下文。
- 质量分与门禁结果。
- SLA 时间线。
- 会签策略与当前进度。
- 反馈候选和 Golden Set 状态。

移动端使用分段视图切换队列、审核和上下文，不同时挤压三栏。

## 10. 一致性与并发

以下记录必须在同一数据库事务中提交：

- 审核决定、任务状态、Artifact 新版本、ArtifactDiff 和审计事件。
- SLA 升级、任务转交、Outbox 和审计事件。
- Golden Sample、候选确认状态和审计事件。

工作流恢复可能涉及模型调用，不应持有长事务。数据库事务先持久化最终决定和唯一恢复请求，再由恢复服务执行；失败则记录 `RESUME_FAILED`。唯一约束与幂等键阻止重复决定、重复升级、重复恢复和重复 Golden Sample。

## 11. 测试策略

### 11.1 单元测试

- 三种审批策略及任一拒绝立即终止。
- 指定人、指定组和轮询分配。
- SLA 状态计算、提醒去重和升级去重。
- HumanTask 状态机合法与非法转换。
- Artifact 版本和 Diff 生成。
- FeedbackCandidate 与 GoldenSample 生成规则。

### 11.2 API 集成测试

- 队列筛选与 SLA 刷新。
- 认领、转交和并发冲突。
- 四种审核决定。
- 重复提交、过期版本和终态任务操作。
- 会签进度与最终决定形成。
- 专家确认和非专家拒绝。

### 11.3 工作流测试

- 人工节点暂停运行。
- 通过后从下游继续。
- 修改后通过使用新版本继续。
- 退回后从原 Agent 节点重跑。
- 驳回后终止运行。
- 恢复失败后保留决定并可幂等重试。

### 11.4 前端与浏览器测试

- 队列筛选、认领和转交。
- Artifact 编辑、Diff 和四种决定。
- 会签进度、SLA 状态和错误提示。
- 移动端分段视图。
- 端到端走通：运行暂停、人工修改、批准、恢复、生成候选、专家确认 Golden Sample。

## 12. 验收标准

V0.6 完成时必须具备以下新证据：

1. Human Review 节点能够暂停 Workflow Run，并在通过后恢复。
2. 退回重跑确实从原 Agent 节点开始，驳回确实终止运行。
3. 三种会签策略均有自动化测试。
4. 超时任务在队列读取或操作时自动升级，且不会重复升级。
5. 每个决定均可追溯操作者、原因、状态变化和 Artifact 版本。
6. 人工修改自动进入 FeedbackCandidate，专家确认后生成唯一 GoldenSample。
7. 相关前后端测试全部通过。
8. `npm run lint` 通过。
9. `npm run build` 通过。
10. 后端测试通过。
11. 完成桌面端和移动端浏览器验证。
12. 更新对应 PRD、Issue 状态与 `docs/CURRENT_IMPLEMENTATION.md`，不将预留能力描述为已实现能力。
