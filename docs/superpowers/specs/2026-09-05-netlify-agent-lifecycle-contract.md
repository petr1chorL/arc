# 04B Agent 生命周期：源码契约盘点

状态：只读盘点，尚未进入实现；不能作为已完成迁移的证据。
来源：当前 `apps/api/app/main.py`、`schemas.py`、`agent_manifest.py`、`src/api/agents.ts`。

## 第一性原理

目的不是让模型执行，而是让用户保存可变草稿、绑定同 Workspace 资产、发布不可变快照，
并能读取、停用和恢复。必要约束是引用归属、角色权限、事务原子性、版本唯一和历史不改写。
04A 为这些引用提供同库登记与查询能力；不能把新库 Agent ID 送给 Zeabur 的旧运行接口。

## 已核实的八条治理路由

共同前缀 `/api/workspaces/{workspace_id}/agents`。

| 方法与后缀 | 成功状态 | 权限 | 关键行为 |
|---|---|---|---|
| GET 根路径 | 200 | asset.read | 当前空间，created_at 倒序 |
| POST 根路径 | 201 | agent.write | 创建；可绑定 Provider，复制其模型配置 |
| GET `/{id}` | 200 | asset.read | 当前空间单条；不存在 404 |
| PATCH `/{id}` | 200 | agent.write | 编辑草稿；按名字解析 Tool/Skill 并保存稳定引用 |
| GET `/{id}/versions` | 200 | asset.read | 确认 Agent 存在后，读取其同空间版本 |
| POST `/{id}/publish` | 201 | agent.publish | 校验 manifest 与依赖、生成快照、更新草稿状态与版本、写审计 |
| POST `/{id}/deactivate` | 200 | asset.deactivate | 停用并审计；不删除历史版本 |
| POST `/{id}/activate` | 200 | agent.write | 有历史版本则在线，否则调试中；不创建版本 |

`/{id}/test-runs` 属于后续执行迁移，本片必须明确阻断，不能回退旧 API。

## 输入与引用事实

- 创建必填 name、role、owner、model，分别上限 80/240/80/80，strip 后非空。
- modelProviderId 可空；Provider 缺失或跨空间 404，disabled 为 422，draft 仍允许绑定。
- temperature 默认 0.2，范围 0–2；maxOutputTokens 默认 2000，范围 1–200000。
- modelProvider 默认 openai-compatible；modelBaseUrl 默认空；runtimeManifest 默认空对象。
- 创建 schema 不接收 tools/skills/systemPrompt；不能凭页面需求给创建接口增加字段。
- PATCH 按 exclude_unset 赋值，不等同于 04A Tool 的 null 跳过语义。非空数据库列显式 null
  的真实错误行为尚需重放，不得把任意 null 都默认为“清空”或“忽略”。
- Tool/Skill 按 assetType + 名称 + Workspace + active 解析；更新和发布都会重建稳定引用。
- 发布快照基于完整 AgentRead；绑定 Provider 时再次读取其类型、URL、模型与 Secret Ref 标签。
  不读取 Secret 值，不外呼。停用 Provider/Tool 不应改写已发布快照。
- runtimeManifest 只允许 `{}` 或现有远程 Agent 的六个固定字段：runtime、sourceType、
  protocolVersion、endpointUrl、secretRef、timeoutSeconds；超时是 1–60 的整数，不接受 bool。
  不能把登记 remote_http 描述成已具备远程执行能力。

## 实施前仍须锁定的兼容边界

1. 当前源码发布/停用分支有非标准中文状态字面量，而恢复分支写入“在线/调试中”。
   需用现有测试和合成请求核实实际输出，区分代码已有问题与迁移兼容；不批量改写生产历史状态。
2. 发布版本号来自已有版本数量。TypeScript 必须验证并发发布不产生重复版本或半写入；
   不能仅照搬计数算法后宣称并发安全。
3. 远程 URL 校验与 04A 的 URL 策略并不完全相同；先重放空 query/fragment、数字主机等边界，
   再记录有意安全差异，不静默复用不同策略。
4. Agent 页面可能依赖版本、资产列表、测试运行等接口。需核对页面调用并定义隔离迁移模式，
   不仅迁移八条路由就标记整个页面完成。

## 下一验证切片

锁定状态与 null/缺省契约 → 制定设计及准确文件计划 → 共享 Python/TS 请求 RED/GREEN →
同库 PG 引用、权限、并发与审计故障 → 浏览器创建/绑定/发布/修改草稿/读取旧版/停用/恢复。
本文件不替代上述设计与验证；04B 状态仍为 needs-triage。

## 2026-09-05 合成动态重放

新增 `scripts/inspect-agent-contract-python.py`，运行命令：
`apps/api/.venv/Scripts/python.exe scripts/inspect-agent-contract-python.py`。
两次执行均退出 0；只创建和清理临时 SQLite，不加载 .env，不调用运行接口或外部服务。
这是一份旧行为探针，不把异常存在当成目标验收通过。

- 生命周期实际输出：创建“调试中”；发布后的行状态为 `\u9366\u3127\u568e`；
  停用为 `\u5bb8\u63d2\u4ee0\u9422?`；恢复已发布 Agent 为“在线”。
  首个发布快照保存的是发布前“调试中”，不能错误地测试为发布后的行状态。
- name、role、owner、model、modelProvider、modelBaseUrl、temperature、maxOutputTokens、systemPrompt
  显式 null 抛 IntegrityError；tools、skills 显式 null 抛 TypeError；数据库原字段均未改变。
  runtimeManifest null 已为 422。
- draft Provider 可以绑定；modelProviderId null 可以解除已有绑定，且保留已复制的 modelProvider、
  modelBaseUrl 与 model 字段。不得把这个合法 null 与上述非法 null 合并处理。
- 远程 manifest 接受正常 HTTPS，也接受空 query/fragment 分隔符和十进制数字主机 `2130706433`；
  拒绝 IP literal 与 userinfo。没有发请求，不是 SSRF 外呼复现或 DNS 可达性验证。
- 页面 `statusText.ts` 已有乱码显示映射，但 Agents 列表统计直接比较“在线/调试中”，
  不能据显示映射就声称状态差异没有用户影响。
- AgentDetail 资产请求失败目前回退空数组；迁移时需单独错误提示，不能伪造“没有可用资产”。

下一步设计见 `2026-09-05-netlify-agent-lifecycle-design.md`；其中有意兼容收缩仍须确认后实施。
