# V1.0 Lite 审核上下文恢复设计

## 决策

采用显式边契约修复 V1 Lite 默认工作流：人工审核同时接收方案设计与 Rubric；
`Human Review -> 审核后修订` 边声明 `includeReviewContext`。恢复服务只在该声明存在时，
把被审核产出物、审核决定和审核理由组装为结构化 JSON 输入。

## 方案比较

### 方案 A：所有 Human 下游统一改为结构化审核上下文

拒绝。虽然语义统一，但会改变既有工作流的下游输入格式，兼容风险超过本次 V1 Lite 缺陷范围。

### 方案 B：仅修改审核后修订 Agent Prompt

拒绝。Prompt 无法恢复运行引擎没有传入的审核理由，也无法补回未连接的方案产出物。

### 方案 C：显式边契约按需传递审核上下文（采用）

优点：只影响声明该契约的链路；现有 WorkflowEdge `data` 已随发布快照冻结；测试可以直接观察
模型输入。缺点：当前编辑器不提供该标记的可视化配置，本切片只用于内置 V1 Lite 工作流。

## 数据流

```text
AI 赋能工作流设计 --\
                       -> 业务负责人审核 -> 审核后修订
评分与验收体系设计 --/                      输入：
                                              reviewedArtifact
                                              reviewDecision.decision
                                              reviewDecision.reason
```

人工任务仍持有一个不可变 ArtifactVersion；该版本内容由两个上游 Agent 产出拼接而成。
审核通过后不修改该版本，只为显式请求审核上下文的下游节点构建运行输入。
默认 Workflow 发布为新的 `v1.3.0` 不可变快照，确保已有 `v1.0.0`-`v1.2.0` 快照不会掩盖
修复；Agent 与 Rubric 版本不变。

## 安全与兼容边界

- 只使用当前 Workspace、当前 Human Task 已关联的 ArtifactVersion 与 ReviewDecision。
- 不改变 Reviewer 权限、参与人快照、审计事件或幂等恢复规则。
- 没有 `includeReviewContext` 的边继续传递原 ArtifactVersion 正文。
- 不新增密钥、网络调用、数据库字段或迁移。

## 验证

1. V1 Lite E2E 测试先断言人工任务产出物包含方案与 Rubric，并因方案缺失而 RED。
2. 同一测试断言审核后修订的模型输入包含产出物、决定和理由，并因理由缺失而 RED。
3. 既有 Human -> End 测试证明未声明契约时仍输出原产出物正文。
4. 运行后端回归、前端测试、lint、build 和真实浏览器路径。
