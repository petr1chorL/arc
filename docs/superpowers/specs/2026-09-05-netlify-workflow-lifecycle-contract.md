# 04E Workflow 源码契约盘点

状态：源码盘点，不是已迁移接口，也不是通过动态重放的契约。
来源：`apps/api/app/main.py`、`schemas.py`、`domain.py`、`execution.py`、
`human_tasks.py`、`src/api/workflows.ts`、`src/pages/Workflows.tsx`。

## 实际治理路由

以下路径均以 `/api/workspaces/{workspace}` 为前缀。

| 路径 | 方法 / 成功 | 能力与副作用 |
|---|---|---|
| `/workflows` | GET / 200 | asset.read；排除已删除，updated_at 倒序 |
| `/workflows` | POST / 201 | workflow.write、CSRF；草稿及成功审计 |
| `/workflows/{id}` | GET / 200 | asset.read；当前空间可见草稿 |
| `/workflows/{id}` | PATCH / 200 | workflow.write、CSRF；完整替换，不是部分 PATCH |
| `/workflows/{id}` | DELETE / 204 | workflow.write、CSRF；软删除和审计，不物理删版本 |
| `/workflows/{id}/validate` | POST / 200 | asset.read；当前实现不要求 CSRF；返回 valid/errors |
| `/workflows/{id}/versions` | GET / 200 | asset.read；created_at 倒序历史 |
| `/workflows/{id}/publish` | POST / 201 | workflow.publish、CSRF；非法定义 422 detail 错误数组 |

创建/完整更新：name 原始长度 1–120，路由随后 trim；nodes/edges 缺省空数组；
inputSchema/outputSchema 缺省 object/properties；支持 Pydantic 对应 snake_case 字段名。
节点为 id/type/position/data，边为 id/source/target/可选 label/data；顶层和节点的未知字段由原模型忽略。
position 为数值映射，具体数值强制转换、null、别名优先级需要真实 Python HTTP fixture 确认，不能凭 TS 类型收紧。
publish body 可缺省；note 缺省空串、上限 500，路由 trim。

WorkflowRead 为 id/name/status/version/nodes/edges/inputSchema/outputSchema/createdAt/updatedAt。
发布按版本数生成 v1.0.0、v1.1.0 等；先创建 WorkflowRead 快照，再更新当前草稿的 version/status。
因此快照中的 version/status 不等于此次版本封套字段，不能无声改成 Rubric 的快照规则。
快照只对节点 inputDataObjectRef/outputDataObjectRef 增加 versionId/snapshot；
Agent、Rubric 已有引用保持原结构，不自动扩为新的嵌入式快照协议。

## 当前校验与缺口

- 已检查节点 ID 唯一、至少一个 trigger/end、连线端点存在、自环及 DAG 环路。
- Agent 节点要求 agentId/agentVersion 指向同空间版本，retryMaxAttempts 为 1–3 的严格整数。
- Data Object 引用检查同空间定义/版本和定义的当前发布状态。
- Evaluation 节点恰好一个输入；rubricRef 的 rubricId/versionId/version/name 必填；
  活跃同空间量规、版本及 LLM Judge/Provider 配置可用。deterministic 量规当前不适用于 Workflow 评估节点。
- Human 节点涉及分配模式、reviewPolicy、门限和 SLA；默认组查找缺少 Workspace 条件，
  组人数统计与资格检验不足；int(...) 对错误类型可能抛异常。这些不是应保留的安全契约。
- 当前服务端没有校验 edge.data.mappings；页面只检查 sourcePath/targetPath 非空。
  执行代码接受对象路径，非法映射会跳过，不代表发布时已保证映射可执行。
- 更新和发布写入包含历史乱码状态；没有完整发布行锁/依赖共享锁/版本碰撞及损坏快照固定错误保护。

这些缺口需要设计、测试和兼容记录；不能把“移植现有函数”直接等同 04E 验收。

## 编排页真实依赖

Workflows 加载工作流、Agent/版本、Data Object、量规/版本和 Provider；还请求：

- GET `/reviewers`：asset.read，当前空间、创建时间正序；
  id/userId(可 null)/name/role/isExpert/isActive。
- GET `/review-groups`：asset.read，当前空间、创建时间正序；
  id/name/assignmentMode/isEscalationGroup/members（ReviewerRead 数组）。

页面目前将目录请求错误 catch 成空数组；迁移模式不能沿用此行为或把新空间 ID 发给 Zeabur。
两个目录不产生任务、不派单、不执行审批。它们是否提前到 04E，已向用户提出范围确认。

## 待建立的动态证据

真实 Python/TS HTTP 完整响应共享 fixture；角色/Origin/CSRF矩阵；损坏历史/跨空间依赖；
实际 PG 发布、编辑、软删除和资产停用竞争；版本/状态/审计原子性；
浏览器创建、引用、映射、校验、两版发布、刷新、失败重试及未迁移运行阻断。
