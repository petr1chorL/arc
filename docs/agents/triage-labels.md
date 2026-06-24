# Triage 状态映射

Matt Pocock Skills 使用五种标准状态。本地 Issue 通过靠近文件顶部的
`Status:` 字段记录状态。

| Matt Pocock 标准状态 | 本项目状态值 | 含义 |
|---|---|---|
| `needs-triage` | `needs-triage` | 等待维护者评估 |
| `needs-info` | `needs-info` | 等待补充必要信息 |
| `ready-for-agent` | `ready-for-agent` | 信息完整，可由 Agent 独立执行 |
| `ready-for-human` | `ready-for-human` | 需要人工判断、权限或操作 |
| `wontfix` | `wontfix` | 明确不处理 |

每个完成 Triage 的 Issue 还必须有且只有一个类别：

- `bug`：已有行为发生错误。
- `enhancement`：新增能力或改进。

同一 Issue 只能有一个类别和一个状态。

