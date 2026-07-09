# V1.0 Lite 端到端验收手册

> 更新时间：2026-06-29

## 目标

用一条真实或默认试点流程证明 V1.0 Lite 可以完成从业务输入到产出、审核、评分和观测的闭环。

## 第一性原理

端到端验收不验“页面是否很多”，只验“业务方是否能独立完成一次有质量门禁的 AI 工作流”。

## 对抗式审查

- 不允许只打开页面就算通过。
- 不允许跳过人工审核节点。
- 不允许把没有保存记录的临时结果算作验收证据。
- 不允许把 V1.0 Lite 验收扩展成完整生产高可用验收。

## 0. 环境自检

自动化验收测试：

```powershell
.\apps\api\.venv\Scripts\python.exe -m pytest .\apps\api\tests\test_v1_lite_e2e_acceptance.py -q
```

该测试使用 FakeGateway，不访问外部模型服务；它验证默认试点资产能跑通 Workflow Run、Human Review、Evaluation、Regression Run 和 Observability Trace。

启动：

```powershell
.\scripts\start-v1-lite.ps1
```

自检：

```powershell
.\scripts\check-v1-lite.ps1
```

生成试点资产：

```powershell
.\scripts\seed-v1-lite.ps1
```

必须看到：

- `frontend` 通过。
- `api-docs` 通过。
- `api`、`web`、`execution-worker`、`notification-worker` 进程存在。
- 种子脚本输出 4 个 Agent、1 条 Workflow、1 套 Rubric、1 个 Golden Set 和 1 个通知渠道。
- 自动化验收测试通过。

## 1. 登录与 Workspace

- [ ] 打开 `http://127.0.0.1:4173`。
- [ ] 使用试点账号登录。
- [ ] 进入试点 Workspace。
- [ ] 记录 Workspace 名称：

## 2. Agent 资产

- [ ] 通过种子脚本或页面确认 4 个试点 Agent：
  - 信息抽取与问题建模
  - AI 赋能工作流设计
  - 评分与验收体系设计
  - 审核后修订
- [ ] 每个 Agent 有职责、模型配置、System Prompt。
- [ ] 每个 Agent 已发布不可变版本。
- [ ] 记录 Agent 版本：

## 3. Workflow 编排

- [ ] 通过种子脚本或页面确认试点 Workflow。
- [ ] 节点顺序符合 `docs/V1_LITE_PILOT_PROCESS.md`。
- [ ] 至少包含 1 个 Human Review 节点。
- [ ] Workflow 已发布不可变版本。
- [ ] 记录 Workflow 版本：
  - 种子脚本默认版本：`v1.0.0`

## 4. 运行试点流程

使用默认样例输入：

```json
{
  "sourceNotes": "安克 AI 课程笔记与个人思维导图摘要",
  "businessContext": "希望构建一个企业 AI 赋能平台，用于编排 Agent、人工审核和质量评分",
  "desiredOutput": "平台落地路线与一个可执行试点流程",
  "riskConcerns": "不要大而全失控，先快速试点；质量评分体系要可落地"
}
```

- [ ] 启动一次 Workflow Run。
- [ ] 运行进入 Human Review 或完成自动节点。
- [ ] 记录 Run ID：

## 5. Human Review

- [ ] 打开人工审核页。
- [ ] 找到本次运行产生的审核任务。
- [ ] 认领任务。
- [ ] 查看产出物。
- [ ] 提交通过、修改后通过或驳回决定。
- [ ] 记录 Human Task ID：

## 6. Evaluation

- [ ] 打开评估中心。
- [ ] 使用试点 Rubric 对产出物评分。
- [ ] 评分结果保存为 Evaluation Record。
- [ ] 注意：Workflow 中的 `Rubric 评分` 节点只提供 Trace 占位，正式评分证据必须来自评估中心保存的 Evaluation Record。
- [ ] 如果评分失败，记录原因并进入修复任务。
- [ ] 记录 Evaluation ID：

## 7. Golden Set / 回归

- [ ] 创建或选择试点 Golden Set。
- [ ] 至少保存 1 条样本。
- [ ] 运行一次批量回归。
- [ ] 记录 Regression Run ID：

## 8. Observability

- [ ] 打开运行观测页。
- [ ] 能看到本次 Run。
- [ ] 能看到 Trace ID、节点状态、成本/Token 或失败原因。
- [ ] 能从观测页回到产出物或审核任务。
- [ ] 记录 Trace ID：

## 9. Notification / Outbox

- [ ] 打开通知运维页。
- [ ] 能看到与审核、SLA 或运行相关的通知记录，或确认当前无待处理通知。
- [ ] 如果存在失败通知，能看到失败码和排障建议。

## 10. 通过标准

全部满足才算 V1.0 Lite 验收通过：

- [ ] 试点流程完成一次端到端运行。
- [ ] 有可追溯 Run ID。
- [ ] 有人工审核证据。
- [ ] 有 Evaluation 评分记录。
- [ ] 有观测页 Trace 证据。
- [ ] 自动化 E2E 测试已通过；真实业务手工验收再补业务可用性判断。
- [ ] 业务方能说明产出物是否可用。
- [ ] 阻断问题已记录。

## 验收记录

| 项 | 值 |
|---|---|
| 验收日期 | |
| 验收人 | |
| Workspace | |
| Workflow Version | |
| Run ID | |
| Human Task ID | |
| Evaluation ID | |
| Regression Run ID | |
| Trace ID | |
| 结论 | |
| 阻断问题 | |
| 后续迭代 | |
