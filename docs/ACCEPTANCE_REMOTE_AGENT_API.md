# 远程 Agent API 切片验收记录

日期：2026-07-15
状态：`ready-for-human`

## 结论

ARC.ONE 已停止提供新的 Python Package 配置、导入与发布路径。自定义 Agent 代码在本切片
只通过同步远程 HTTP API 接入；平台内置 ModelGateway 仍作为另一种明确的执行方式保留。

远程 Agent 发布后可进入 Agent Test Run 和 Workflow Agent 节点，结果继续由 ARC.ONE
落为 Run、NodeRun 和 Artifact，并参与既有 Human Review、Evaluation 与观测闭环。
这是一版可运行、可审查的 V1 Lite 接入协议，不是生产级通用 Agent 服务协议。

## 第一性原理核查

底层目标不是“上传代码”，而是让外部团队拥有和部署 Agent 代码，同时让 ARC.ONE 仍掌握：

1. 调用了哪个 AgentVersion；
2. 哪次 Run/NodeRun 发起调用；
3. 输入、输出、用量、失败和重试如何记录；
4. 结果如何进入 Artifact、人工审核和评估；
5. 哪个 Workspace 可以把哪个 Secret 发给哪个精确 Host。

因此最小必要对象是不可变 Runtime Manifest、稳定调用标识、严格请求/响应协议、部署侧
`Workspace + Host + Secret Ref` 三元绑定，以及平台自己的 Run/NodeRun/Artifact 状态。
CLI 只方便人工触发，不能解决中心编排；Python Package 会让平台承担任意代码依赖和执行边界。
同步单请求协议是当前验证外部接入价值所需的最小切片。

## 已实现范围

- Agent 详情页只提供“平台托管（ModelGateway）”和“远程 Agent API”。
- 远程 Manifest 固定为 `remote_http`、`remote_api`、`arc-agent-v1`、HTTPS Endpoint、
  Secret Ref 和 1–60 秒超时，并随 AgentVersion 冻结。
- 浏览器不请求远程 Endpoint，也不接收或保存 Token；后端解析部署环境中的 Secret Ref。
- 远程调用使用 Bearer Token、`Idempotency-Key` 和 Trace Header。
- invocation ID 与协议逻辑 NodeRun ID 确定性生成；传输重试和队列重试的完整请求保持一致。
- 只接受 HTTP 200、精确 JSON media type、严格字段、有限用量值和最多 1 MiB 响应。
- 网络错误、429、500、502、503、504 可重试；其他 4xx 和协议错误不重试；总尝试为 1–3 次。
- Agent Test Run 与 Workflow Agent 节点均可生成平台 Artifact。

## 安全与隔离边界

- Endpoint 必须使用 HTTPS、443、域名；拒绝 IP literal、userinfo、query、fragment 和重定向。
- HTTP Client 使用 `trust_env=False`，不会继承环境代理。
- `AGENT_API_ALLOWED_BINDINGS` 每项必须使用
  `<workspace-id>@<host>=<SECRET_REF>`；三元组不匹配时在读取环境变量和发起 HTTP 前拒绝。
- 任意其他进程环境变量即使存在，也不能被 Manifest 借用并发送给远端。
- 不同 Workspace 不能复用其他 Workspace 的外呼绑定。
- 原始响应、Authorization 和密钥值不进入错误、审计或 Trace。
- 模型名称、Token 合计、成本、工具调用数量和响应字节受持久化前边界校验。
- 远端自报 usage 只作观测，不作为可信账单或 Evaluation；质量分由平台计算。

## 历史 Python Package 处理

- 新建、配置、导入和发布 Package 的前后端入口已经移除。
- 历史 AgentVersion 快照数据不删除、不改写，仍可通过版本 API 读取。
- 历史发布版本没有执行器，运行时固定失败关闭，不回退 ModelGateway、CLI 或进程内 import。
- 当前草稿若仍含旧 Package Manifest，页面进入只读迁移状态；用户必须明确选择平台托管或
  远程 Agent API，保存和发布前不会静默把 Manifest 改成空对象。

## TDD 与验证证据

### RED

- 初始后端聚焦测试因 `app.agent_api_gateway` 不存在而收集失败。
- 初始前端远程配置、校验和迁移场景共 6 项失败。
- `runtimeManifest: null` 回归测试复现了写入坏数据后响应 500，随后改为写库前 422。
- 对抗式测试复现了任意环境变量可被 Secret Ref 借用、异步重试 `nodeRunId` 改变、旧草稿
  静默迁移、发布弹窗遮住配置错误、IP literal 未拦截和重试次数无上限。
- 最终边界测试又复现了总截止时间未覆盖响应头等待、队列重试以同一幂等键发送不同请求体，以及
  多节点 Token 聚合可能超过数据库整数边界。

### GREEN

| 检查 | 结果 |
|---|---|
| 远程 API 相关后端聚焦回归 | 112 项通过，84 秒 |
| Agent 详情页聚焦回归 | 14 项通过，14.94 秒 |
| 后端全量回归（最终边界收口前基线） | 386 项通过，303.4 秒；仅保留 Starlette/httpx 依赖弃用警告 |
| 最终边界收口回归 | Gateway 23 + Runtime 13 + Execution 51，共 87 项通过 |
| 前端全量回归 | 43 文件 / 261 项通过，17.17 秒 |
| `npm run lint` | 通过 |
| `npm run build` | 通过；保留既有大 Chunk 警告 |
| `npm run deploy:check` | 通过 |
| `git diff --check` | 通过 |

### 浏览器验证

使用隔离 E2E 数据库和测试账号在应用内浏览器完成：创建 Agent、切换远程 API、填写
Endpoint/Secret Ref/超时、保存草稿、填写发布备注并发布 `v1.0.0`。页面显示保存和发布成功，
远程模式下模型字段禁用，页面无 Package 导入入口，浏览器 console 无 error/warn。

## 对抗式审查结论

已修复：任意环境变量外泄、跨 Workspace 外呼绑定、队列重试请求体漂移、数据库字段边界、
无限重试、旧草稿静默迁移、发布错误不可见和历史文档误导。

仍需明确保留的限制：

- 首版只有同步 POST；无异步轮询/回调、SSE、协作式取消或多 Artifact 协议。
- 没有独立 Endpoint/Connection 资产、审批、轮换 API 或 Vault 集成；绑定由部署配置管理。
- 没有通用私网 DNS 出口代理或 DNS pinning；获准 Host 的 DNS 与网络边界仍由运维负责。
- 本地总截止时间可取消连接、响应头等待和正文读取；取消不能保证远端服务停止执行，
  因此远端仍必须按 `Idempotency-Key` 去重。
- `toolCalls` 只经过协议约束并保留在运行时结果，当前未形成独立持久化调用明细。
- 真实业务服务、真实 Token 轮换、负载、SLO、故障注入和生产签收尚未完成。

在以上限制关闭或被业务明确接受前，不得把该切片描述为生产级 Agent 托管平台。
