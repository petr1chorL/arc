# V1.0 Lite 业务验收表

> 更新时间：2026-06-29
> 适用对象：业务验收人、试点负责人

## 验收目标

确认业务方能独立完成一次 `输入 -> Agent/Workflow -> Human Review -> Evaluation -> Observability` 闭环，并判断产出物是否足够进入试点使用。

## 验收前提

开始前先确认技术侧已就绪：

```powershell
.\scripts\audit-v1-lite-signoff.ps1 -OutputPath ".scratch\runtime\v1-lite-signoff-audit.json"
```

通过标准：

- `status=ready_for_business_signoff`
- `technicalGates=passed`
- `failures=[]`

如果不满足，先不要做业务签收。

## 验收地址

当前本地服务地址：

```text
http://127.0.0.1:54173
```

如果重新启动后端口不同，以启动脚本输出为准。

## 10 分钟验收步骤

| 步骤 | 操作 | 通过标准 | 结果 |
|---|---|---|---|
| 1 | 登录并进入 `AI 能力中心` Workspace | 能看到运营总览 | 通过 / 不通过 |
| 2 | 打开 Agent 页面 | 能看到 4 个 V1 Lite 试点 Agent | 通过 / 不通过 |
| 3 | 打开 Workflow 页面 | 能看到 `AI 赋能方案 V1.0 Lite 试点工作流`，版本为 `v1.0.0` | 通过 / 不通过 |
| 4 | 发起一次 Workflow Run | 能提交样例输入并生成 Run ID | 通过 / 不通过 |
| 5 | 打开人工审核页面 | 能看到本次 Human Task，并能认领/通过/驳回 | 通过 / 不通过 |
| 6 | 打开评估中心 | 能用 V1 Lite Rubric 保存一次 Evaluation Record | 通过 / 不通过 |
| 7 | 运行或查看 Golden Set 回归 | 能看到 Regression Run 或默认 3 条样本 | 通过 / 不通过 |
| 8 | 打开运行观测 | 能用 Run ID 看到 Trace、节点状态、执行事件 | 通过 / 不通过 |
| 9 | 打开通知运维 | 能看到页面内通知或确认当前无待处理通知 | 通过 / 不通过 |
| 10 | 判断产出物 | 业务方能判断产出是否可用，并写出原因 | 通过 / 不通过 |

## 默认样例输入

```json
{
  "sourceNotes": "安克 AI 课程笔记与个人思维导图摘要",
  "businessContext": "希望构建一个企业 AI 赋能平台，用于编排 Agent、人工审核和质量评分",
  "desiredOutput": "平台落地路线与一个可执行试点流程",
  "riskConcerns": "不要大而全失控，先快速试点；质量评分体系要可落地"
}
```

## 必填证据

| 字段 | 填写 |
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
| Notification Outbox 是否可见 | 是 / 否 |
| 产出物是否可用 | 可用 / 不可用 / 需修改 |
| 阻断问题数量 | |
| 非阻断问题数量 | |
| 签收结论 | 通过 / 不通过 |

## 业务可用性判断

产出物至少要满足：

- 业务目标说得清楚。
- Workflow 节点边界能理解。
- 人工审核位置合理，没有绕过关键风险。
- Rubric 维度和权重能解释。
- 后续迭代项没有混进 V1.0 Lite 必做范围。

## 不通过时怎么处理

如果出现以下情况，记录到 `docs/V1_LITE_PILOT_ISSUE_LOG.md`，不要签收：

- 无法登录或进入 Workspace。
- Workflow 无法启动或无法完成。
- Human Review 无法处理。
- Evaluation 无法保存。
- Trace / Run ID / Human Task ID / Evaluation ID 缺失。
- 发现密钥、Token、`.env` 值或客户敏感原文泄露。

如果只是体验、文案、效率或后续增强，记录为 P2/P3 或 V1.1+ 候选，不阻断 V1.0 Lite。
