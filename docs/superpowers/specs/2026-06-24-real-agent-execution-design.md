# 真实 Agent 执行闭环设计

## 目标

让已发布 Agent 和工作流版本可以接收真实输入、调用 OpenAI-compatible 模型服务，并持久化完整运行证据。

## 执行边界

本阶段采用同步执行内核：

- API 请求创建运行并顺序执行工作流。
- 接口与持久化模型不依赖具体供应商。
- 后续可将同一执行服务迁移到 Temporal Worker，而不改变前端 Run 契约。

## 模型网关

环境变量：

- `MODEL_API_KEY`：模型服务密钥。
- `MODEL_BASE_URL`：OpenAI-compatible 服务地址，不含 `/chat/completions`。
- `MODEL_DEFAULT_MODEL`：Agent 未指定可用模型时的回退模型。

当前项目默认配置：

- `MODEL_BASE_URL=https://api.deepseek.com`
- `MODEL_DEFAULT_MODEL=deepseek-v4-pro`
- 使用 OpenAI-compatible `/chat/completions`。
- 暂不启用 `https://api.deepseek.com/anthropic`，避免同时维护两套消息协议。
- `MODEL_INPUT_USD_PER_MILLION_TOKENS`
- `MODEL_OUTPUT_USD_PER_MILLION_TOKENS`
- `MODEL_TIMEOUT_SECONDS`

密钥不得写入数据库、响应、日志或前端。

## Agent 测试运行

调用已发布 AgentVersion 快照：

1. 组合 System Prompt、职责、Tools 与 Skills。
2. 用户输入作为 user message。
3. 调用模型网关。
4. 保存 NodeRun，包括模型、版本、输入输出、Token、成本、耗时和重试次数。
5. 执行基础质量门禁。

## 工作流运行

1. 只允许运行已发布 WorkflowVersion。
2. 使用 DAG 拓扑序执行。
3. Trigger 节点将运行输入传给下游。
4. Agent 节点调用对应 AgentVersion。
5. 普通节点暂按透传节点执行并记录。
6. End 节点保存最终 Artifact。
7. Agent 节点失败最多尝试两次。
8. 任一节点最终失败，Run 标记为失败。

## 基础质量门禁

当前确定性规则：

- 空输出：0 分。
- 1-19 个字符：50 分，Run 标记为“需介入”，创建 HumanReview。
- 20 个字符及以上：100 分，通过。

该规则仅用于验证质量路由基础设施，不代表正式业务 Rubric。

## 数据对象

- `WorkflowRun`：整次运行状态、输入、最终输出、总 Token、总成本、质量分。
- `NodeRun`：节点级执行证据。
- `Artifact`：最终产出物及来源运行。
- `HumanReview`：低分输出的人工审核任务。

## 前端

- Agent 详情增加测试运行工作台。
- 工作流设计器增加运行输入弹窗和运行按钮。
- 运行中心读取真实 Run/NodeRun。
- 人工审核页读取真实低分任务。

## 安全

- 前端永远不接触 API Key。
- API 错误不得包含请求头或密钥。
- 环境变量缺失时返回明确的“模型服务未配置”，不回显配置值。
