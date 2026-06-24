# Agent 与工作流生命周期设计

## 目标

在现有 Agent 创建持久化基础上，完成两个连续闭环：

1. Agent 草稿编辑、Tool/Skill 配置、不可变版本发布、历史版本查看和停用。
2. 工作流创建、Agent 已发布版本引用、草稿保存、DAG 校验、不可变版本发布和刷新重载。

## Agent 生命周期

Agent 主记录表示可编辑草稿，包含名称、职责、负责人、模型、System Prompt、Tools、Skills 和状态。

发布时：

- 对草稿字段生成完整快照。
- 创建新的 `AgentVersion`。
- 第一版为 `v1.0.0`，后续按次版本递增。
- 已发布快照不提供更新和删除接口。
- 主记录显示最新发布版本，但后续草稿修改不会改变历史版本。

停用时：

- 主记录状态改为 `已停用`。
- 历史版本仍可被已有工作流版本追溯。
- 停用 Agent 不允许再次编辑或发布。

## 工作流生命周期

工作流主记录表示可编辑草稿，保存平台领域 JSON：

- `nodes`：节点标识、类型、位置和节点配置。
- `edges`：连线标识、来源、目标和可选标签。
- Agent 节点通过 `agentId` 与 `agentVersion` 引用不可变版本。

发布前验证：

- 至少包含一个触发节点和一个结束节点。
- 节点 ID 唯一。
- 连线两端必须存在。
- 不允许自环或有向环。
- Agent 节点必须引用存在的已发布 Agent 版本。

发布时创建 `WorkflowVersion` 完整快照。之后修改草稿不影响已发布版本。

## API

### Agent

- `GET /api/agents/{id}`
- `PATCH /api/agents/{id}`
- `GET /api/agents/{id}/versions`
- `POST /api/agents/{id}/publish`
- `POST /api/agents/{id}/deactivate`

### 工作流

- `GET /api/workflows`
- `POST /api/workflows`
- `GET /api/workflows/{id}`
- `PATCH /api/workflows/{id}`
- `GET /api/workflows/{id}/versions`
- `POST /api/workflows/{id}/validate`
- `POST /api/workflows/{id}/publish`

## 界面

### Agent 详情

- 从 Agent 列表点击名称进入详情页。
- 基本信息、模型、System Prompt、Tools、Skills 可编辑。
- 明确显示“未保存草稿”“已保存”“已停用”状态。
- 发布按钮生成新版本。
- 版本历史展示发布时间和快照摘要。

### 工作流设计器

- 支持新建和切换工作流。
- 保存按钮写入真实 API。
- Agent 节点配置使用已发布 Agent 版本。
- 发布按钮先执行 DAG 校验，错误在页面内展示。
- 版本记录显示已发布快照。

## 本阶段不包含

- Agent 删除。
- 工作流执行、试运行和模型调用。
- 多人协同冲突处理。
- 权限、审批和审计用户身份。
- 复杂节点参数 Schema 编辑器。
