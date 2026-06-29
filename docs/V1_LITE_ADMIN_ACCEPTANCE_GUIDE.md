# V1.0 Lite 管理员验收手册

> 更新时间：2026-06-29
> 适用对象：平台管理员、Workspace 管理员、试点交付负责人

## 管理员目标

管理员要确认 V1.0 Lite 不只是能打开页面，而是具备试点交付条件：

- 环境能启动和停止。
- 账号、Workspace、角色和审核资格正确。
- 试点 Agent、Workflow、Rubric、Golden Set 已准备。
- 试点能产生 Run ID、Human Task ID、Evaluation ID、Trace ID。
- 阻断问题已记录并分级。

## 第一性原理

管理员验收的底层问题是：这套系统是否足够支撑一个受控试点，而不是是否已经达到完整生产平台标准。

## 对抗式审查

- 不用高可用、Kubernetes、完整 CI/CD 来卡住 V1.0 Lite。
- 不把 mock、占位或 Noop 通知当成真实外部投递能力。
- 不允许密钥出现在前端、日志、数据库、文档或截图中。
- 不允许没有审核资格的人处理 Human Task。
- 不允许缺少 Trace 证据就签收。

## 1. 环境准备

启动：

```powershell
.\scripts\start-v1-lite.ps1
```

自检：

```powershell
.\scripts\check-v1-lite.ps1
```

停止：

```powershell
.\scripts\stop-v1-lite.ps1
```

验收要求：

- `frontend` 通过。
- `api-docs` 通过。
- `api`、`web`、`execution-worker`、`notification-worker` 进程存在。
- `.scratch/runtime/v1-lite-pids.json` 能反映当前启动进程。

## 2. 账号和 Workspace 检查

| 检查项 | 通过标准 | 结果 |
|---|---|---|
| 试点账号可登录 | 能进入平台 | |
| Workspace 正确 | 登录后进入试点 Workspace | |
| Workspace 管理员存在 | 至少 1 人可管理资产和成员 | |
| 构建者存在 | 至少 1 人可配置 Agent 和 Workflow | |
| 审核人存在 | 至少 1 人具备 Review Qualification | |
| 观察者存在 | 可只读查看运行和观测结果 | |

## 3. 资产准备检查

按 `docs/V1_LITE_ASSET_TEMPLATES.md` 配置：

| 资产 | 通过标准 | 结果 |
|---|---|---|
| Agent 1 | 已创建并发布版本 | |
| Agent 2 | 已创建并发布版本 | |
| Agent 3 | 已创建并发布版本 | |
| Agent 4 | 已创建并发布版本 | |
| Workflow | 已创建、DAG 校验通过、发布版本 | |
| Human Review 节点 | 已指定具备审核资格的审核人 | |
| Rubric | 已创建或启用，权重合计 100 | |
| Golden Set | 至少 1 条样例 | |

## 4. 运行证据检查

一次有效试点必须记录：

| 证据 | 来源 | 结果 |
|---|---|---|
| Workflow Version | Workflow 详情或版本记录 | |
| Run ID | 运行中心或观测页 | |
| Human Task ID | 人工审核页 | |
| Evaluation ID | 评估中心 | |
| Regression Run ID | Golden Set / 回归运行 | |
| Trace ID | Observability | |
| Notification Outbox 记录 | 通知运维页，可为空但需记录 | |

## 5. 安全和边界检查

必须确认：

- 文档和截图中没有 API Key、Token、私钥或 `.env` 值。
- Model Provider 只显示非密钥配置和 `secretRef` 标签。
- 试点不使用真实客户敏感数据，除非业务方已确认授权。
- 跨 Workspace 无法看到其他 Workspace 的 Agent、Workflow、Run、Human Task、Evaluation。
- 已发布 Agent Version 和 Workflow Version 不被后续草稿编辑修改。

## 6. 常见失败分类

| 分类 | 现象 | 管理员动作 |
|---|---|---|
| 环境失败 | 页面打不开或 API docs 打不开 | 重新运行启动脚本和自检脚本，查看日志 |
| 账号失败 | 无法登录或进入错误 Workspace | 检查账号、成员关系和 Workspace 路由 |
| 权限失败 | 无法创建资产或处理审核任务 | 检查角色和 Review Qualification |
| 资产失败 | Workflow 无法发布或运行 | 检查 Agent 版本、DAG、Human Review 节点 |
| 运行失败 | Run 卡住或节点失败 | 查看 Observability、执行队列和失败原因 |
| 审核失败 | 只能认领，不能通过/驳回 | 检查任务归属、审核资格和当前用户 |
| 评分失败 | Evaluation 无结果或低分 | 检查 Rubric、产出物和失败维度 |
| 通知失败 | Outbox 有失败码 | 查看失败码和排障建议，必要时重新入队 |

## 7. 签收标准

满足以下条件可签收 V1.0 Lite 试点：

- 环境自检通过。
- 业务方按用户手册完成一次运行。
- 管理员收集到 Run ID、Human Task ID、Evaluation ID、Trace ID。
- 产出物被业务方判定为可用，或明确记录为什么不可用。
- 阻断问题为 0；非阻断问题已进入问题清单。
- 后续范围明确进入 V1.1+，没有被误认为 V1.0 Lite 必须完成。

## 8. 管理员签收表

| 项 | 值 |
|---|---|
| 验收日期 | |
| 管理员 | |
| Workspace | |
| Workflow Version | |
| Run ID | |
| Human Task ID | |
| Evaluation ID | |
| Regression Run ID | |
| Trace ID | |
| 阻断问题数 | |
| 非阻断问题数 | |
| 签收结论 | 通过 / 不通过 |
| 备注 | |
