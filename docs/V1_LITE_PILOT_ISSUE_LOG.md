# V1.0 Lite 试点问题清单

> 更新时间：2026-06-29
> 用途：记录 V1.0 Lite 试点验收中发现的问题、阻断项和后续迭代项。

## 使用原则

问题清单不是吐槽板，而是交付控制表。每一条问题都必须能回答：

- 影响哪个验收证据。
- 是否阻断 V1.0 Lite 签收。
- 谁负责处理。
- 复测证据是什么。
- 是否应后置到 V1.1+。

## 第一性原理

V1.0 Lite 的问题管理只服务一个目标：保护试点闭环真实可用，不让阻断问题被口头带过，也不让后置需求挤爆当前范围。

## 对抗式审查

- 不把新想法都写成 V1.0 Lite 阻断项。
- 不把真实阻断项写成“后续优化”。
- 不接受没有证据的“已修复”。
- 不记录密钥、Token、`.env` 值或客户敏感原文。

## 严重级别

| 级别 | 定义 | 是否阻断签收 |
|---|---|---|
| P0 | 无法登录、无法启动、无法运行试点主链路、数据/密钥泄露 | 是 |
| P1 | 运行、审核、评分、Trace 任一关键证据缺失 | 是 |
| P2 | 影响效率或理解，但有明确绕行办法 | 否 |
| P3 | 文案、布局、说明、后续体验优化 | 否 |

## 问题分类

| 分类 | 示例 |
|---|---|
| 环境 | 启动失败、自检失败、端口占用 |
| 账号权限 | 登录失败、Workspace 错误、审核资格缺失 |
| 资产配置 | Agent 未发布、Workflow 无法发布、Rubric 缺失 |
| 运行执行 | Run 失败、队列卡住、节点异常 |
| 人工审核 | 无法认领、无法通过/驳回、审核意见未保存 |
| 质量评估 | Evaluation 不保存、评分维度错误、Golden Set 无法运行 |
| 观测追踪 | Trace ID 缺失、产出物链接断开、失败原因不可见 |
| 通知运维 | Outbox 失败、失败码无建议、重新入队失败 |
| 文档交付 | 手册步骤不清、验收记录缺字段 |
| 后续范围 | 适合放到 V1.1+ 的增强项 |

## 当前问题表

| ID | 日期 | 级别 | 分类 | 标题 | 影响证据 | 负责人 | 状态 | 是否阻断 V1.0 Lite | 复测证据 |
|---|---|---|---|---|---|---|---|---|---|
| V1L-ISSUE-001 | 2026-06-29 | P0 | 环境 / 运行执行 | 当前 worktree API 未配置模型密钥，真实服务验收停在第一个 Agent 节点 | Run ID / Human Task ID / Evaluation ID / Trace ID | 试点管理员 | closed | 否 | `accept-v1-lite.ps1` 已输出完整证据 JSON：Run `db29cdef-d074-4e05-96ae-bc017633482c` |

状态取值：

- `open`：已确认，尚未处理。
- `in_progress`：处理中。
- `ready_for_retest`：等待复测。
- `closed`：已复测关闭。
- `deferred_to_v1.1`：非阻断，后置到 V1.1+。

## 单条问题模板

```markdown
## V1L-ISSUE-XXX：标题

- 日期：
- 提出人：
- 级别：P0 / P1 / P2 / P3
- 分类：
- 是否阻断 V1.0 Lite：是 / 否
- 影响证据：Run ID / Human Task ID / Evaluation ID / Trace ID / 其他
- 当前状态：open / in_progress / ready_for_retest / closed / deferred_to_v1.1
- 负责人：

### 现象

描述用户看到了什么，不粘贴密钥、Token、私钥、`.env` 值或客户敏感原文。

### 复现步骤

1.
2.
3.

### 期望结果


### 实际结果


### 临时绕行办法


### 处理结论


### 复测证据

- 复测日期：
- 复测人：
- Run ID：
- Human Task ID：
- Evaluation ID：
- Trace ID：
- 结论：
```

## V1L-ISSUE-001：当前 worktree API 未配置模型密钥，真实服务验收停在第一个 Agent 节点

- 日期：2026-06-29
- 提出人：Codex 自动验收
- 级别：P0
- 分类：环境 / 运行执行
- 是否阻断 V1.0 Lite：否
- 影响证据：Run ID / Human Task ID / Evaluation ID / Trace ID
- 当前状态：closed
- 负责人：试点管理员

### 现象

`.\scripts\accept-v1-lite.ps1` 能登录、读取 Workspace、确认 Reviewer 资格并启动默认 Workflow，
但 Workflow Run 在 `信息抽取与问题建模` Agent 节点失败，无法进入 Human Review，因此不能产出
Human Task ID、Evaluation ID、Regression Run ID 和 Trace ID 签收证据。

### 复现步骤

1. 启动当前 worktree 的 V1 Lite 服务。
2. 运行 `.\scripts\seed-v1-lite.ps1`。
3. 设置 `ARC_ONE_ACCEPTANCE_EMAIL` 和 `ARC_ONE_ACCEPTANCE_PASSWORD`。
4. 执行 `.\scripts\accept-v1-lite.ps1 -ApiUrl http://127.0.0.1:58000 -OutputPath ".scratch\runtime\v1-lite-runtime-acceptance.json"`。

### 期望结果

脚本输出 `status=passed`，并包含 Run ID、Human Task ID、Evaluation ID、Regression Run ID 和 Trace ID。

### 实际结果

Workflow Run `a365ff01-1c80-4fd9-9e5f-fb36c07e3808` 返回 `失败`，当前节点为
`信息抽取与问题建模`，错误为 `Agent 执行失败，请稍后重试`。本地配置检查显示当前 worktree
API 进程未读取到模型密钥；未记录任何密钥值。

### 临时绕行办法

在运行 API 前，通过 `.env`、系统环境变量或部署平台 Secret 配置 `MODEL_API_KEY`，或配置 Agent
Provider `secretRef` 对应的环境变量。不要把密钥写入 Git、文档、截图或验收 JSON。

### 处理结论

已增加 `start-v1-lite.ps1 -EnvFile`、`seed-v1-lite.ps1 -EnvFile` 和
`bootstrap-v1-lite-admin.ps1 -EnvFile`，确保 worktree 场景下 API、Worker、管理员初始化和种子资产使用同一份本地 env 配置。
真实服务验收已复测通过；FakeGateway 自动测试仍保留为工程回归检查，但不替代真实服务证据。

### 复测证据

- 复测日期：2026-06-29
- 复测人：Codex 自动验收
- Run ID：`db29cdef-d074-4e05-96ae-bc017633482c`
- Human Task ID：`0d870943-8175-4058-adb9-8c73bd193585`
- Evaluation ID：`a9266557-718d-4ec9-b86e-7686128caee5`
- Regression Run ID：`aa2e880e-4443-423b-a02c-9a717372c046`
- Trace ID：`trace-db29cdef-d074-4e05-96ae-bc017633482c`
- 结论：通过。Workflow Run 状态为 `已完成`，Human Task 状态为 `已通过`，Evaluation 状态为 `passed`，得分 86，Golden Set 样本数 3，Execution Event 数 15，Notification Outbox 数 16。

## 生产部署启动事故（2026-07-15，待公网复测）

### 现象

`3bd30c9` 发布后静态登录页与 `deployment.json` 可访问，但 `/api/health` 持续 502。生产已
回滚到 `fc59082`，API 恢复 200；当前生产与 `master` 暂时不一致。

### 已确认失效链

- 旧 PostgreSQL 未补齐 `rubrics.model_provider_id`。
- V1 Lite Seed 需要配置完整且未停用的 Model Provider。
- 原根镜像会后台化整条后端链，后端失败时 Nginx 仍提供静态页面与固定健康响应。

当前没有取得 Zeabur 容器异常栈，因此不把某一条异常文本描述成已确认线上日志。

### 处理状态

热修复正在功能分支验证：定向补列、仅 Provider 不可用时结构化跳过 Seed、FastAPI 就绪后
才开放 Nginx、API 退出联动容器退出，并让 `/healthz` 代理 API。只有 PR/CI、精确 SHA 部署、
`/healthz`、`/api/health`、真实登录和 Seed 状态取得新证据后，才可关闭该事故。

## V1.1+ 候选项

以下事项默认不是 V1.0 Lite 阻断项，除非它们直接阻断试点主链路：

| 候选项 | 价值 | 进入条件 |
|---|---|---|
| 模板一键导入 | 降低配置成本 | V1.0 Lite 手工模板被验证可用 |
| 飞书文档读取 | 减少复制粘贴 | 明确飞书权限和数据边界 |
| 真实通知渠道接入 | 提升协作效率 | Outbox 治理闭环稳定 |
| 自动生成验收报告 | 降低交付成本 | 验收字段稳定 |
| Agent 自动优化 | 提升质量迭代速度 | Rubric 和 Golden Set 有足够样本 |

## 签收前检查

- [ ] 所有 P0/P1 问题已关闭。
- [ ] P2/P3 问题有负责人和后续处理版本。
- [ ] `deferred_to_v1.1` 的问题没有伪装成 V1.0 Lite 已完成能力。
- [ ] 每个关闭问题都有复测证据。
- [ ] 没有记录密钥、Token、私钥、`.env` 值或敏感客户原文。
