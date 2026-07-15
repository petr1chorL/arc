# 远程 Agent API 执行设计

## 1. 决策

保留当前平台内置 ModelGateway 执行方式；自定义代码接入只新增 `remote_http` 执行器。
Python Package 不再是可配置或可发布的新运行方式，历史快照保持不可变并失败关闭。

第一切片采用 Agent 草稿内的版本化 Endpoint 配置与部署级 Workspace、Host、Secret Ref 三元绑定，不新增独立
Endpoint 资产表。该选择先验证真实外部接入价值；若试点出现复用、轮换、审批或影响面需求，
再把内联配置迁移为 Workspace EndpointVersion 引用。

## 2. 方案比较

### A. AgentVersion 冻结 API 配置（采用）

改动窄，可复用现有草稿、发布快照、权限和运行入口；Workspace、Host、Secret Ref 组合仍由部署绑定控制。缺点是
Endpoint 复用、停用与影响面治理尚未独立建模。

### B. 先建设 Workspace Endpoint 资产

治理完整，但需要新表、生命周期 API、页面、影响面和审计，超过验证远程调用价值所需范围。

### C. 复用 HTTP Tool 资产

拒绝。Tool 调用没有 AgentVersion、NodeRun 结果、Token/成本、重试和 Artifact 语义。

## 3. Manifest

平台内置执行使用空对象。远程执行使用唯一规范结构：

```json
{
  "runtime": "remote_http",
  "sourceType": "remote_api",
  "protocolVersion": "arc-agent-v1",
  "endpointUrl": "https://agent.example.com/v1/invoke",
  "secretRef": "RESEARCH_AGENT_API_TOKEN",
  "timeoutSeconds": 30
}
```

保存和发布要求：HTTPS；无 userinfo/query/fragment；默认 443 端口；Secret Ref 符合
`[A-Z_][A-Z0-9_]*`；超时为 1-60 秒整数；拒绝未知字段和未知执行方式。

## 4. 调用协议

请求为同步 `POST`：

```json
{
  "protocolVersion": "arc-agent-v1",
  "invocationId": "deterministic-uuid",
  "agent": {"id": "...", "version": "v1.0.0"},
  "run": {"id": "...", "nodeRunId": "...", "nodeId": "..."},
  "input": "...",
  "context": {
    "workspaceId": "...",
    "nodeName": "...",
    "systemPrompt": "...",
    "tools": [],
    "skills": []
  }
}
```

Header 包含 `Authorization: Bearer <resolved secret>`、`Idempotency-Key` 和脱敏 Trace ID。
invocation ID 与协议中的逻辑 NodeRun ID 都由 Workspace、Run、Node 和 AgentVersion 确定性生成，
同一传输或队列重试的 Header 和完整请求体保持不变；本地每次尝试仍保留独立 NodeRun 记录。

成功只接受 HTTP 200、`application/json` 和最多 1 MiB 的严格响应：

```json
{
  "protocolVersion": "arc-agent-v1",
  "invocationId": "same-id",
  "output": "最终文本",
  "usage": {
    "model": "optional",
    "promptTokens": 0,
    "completionTokens": 0,
    "costUsd": 0
  },
  "toolCalls": []
}
```

远端自报 usage 只进入运行观测，不作为可信账单或 Evaluation；质量分由平台基于输出重新计算。

## 5. 安全边界

- 最终调用前校验 HTTPS、默认端口、无 IP literal、无重定向，以及 Workspace、精确 Host、Secret Ref 三元绑定；默认 HTTP client 使用 `trust_env=False`。
- 只有三元绑定通过后才解析 Secret Ref；不转发用户 Cookie、Model Key 或 Tool 凭证。
- 只对网络错误、429、500、502、503、504 重试，总次数限制为 1–3；其他 4xx 和协议错误不重试。
- 原始响应、Authorization 和密钥值不进入错误、审计或 Trace。
- 远端不能写入 Workspace、Run、Artifact、Human Review、Evaluation 或平台评分状态。
- 历史 `python_package` 不自动迁移、不回退 ModelGateway、不执行 CLI 或进程内 import。

## 6. 范围边界

首版不做远端异步状态、回调、SSE、协作式取消、Endpoint 资产、连接测试、多 Artifact、
二进制内容、mTLS/Vault 或完整私网 DNS 阻断。在这些能力完成前，不把第一切片描述为
生产级通用 Agent 服务协议。
