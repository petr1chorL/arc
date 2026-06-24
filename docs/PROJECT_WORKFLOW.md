# ARC.ONE 项目管理与开发流程

## 目的

ARC.ONE 同时采用两套互补方法：

- Matt Pocock Skills：管理领域语言、PRD、Issue、Triage 和 Handoff。
- Superpowers：管理设计确认、实施计划、TDD、系统调试和完成验证。

项目必须同时经过这两条链路。项目文档不能替代工程验证，测试通过也不能替代
产品范围和领域定义。

## 信息源

| 内容 | 信息源 |
|---|---|
| 标准领域语言 | `CONTEXT.md` |
| 当前已验证实现 | `docs/CURRENT_IMPLEMENTATION.md` |
| 长期建设方向 | `docs/PROJECT_MASTER_PLAN.md` |
| 当前功能需求 | `.scratch/<feature>/PRD.md` |
| 可执行功能切片 | `.scratch/<feature>/issues/` |
| 已确认设计 | `docs/superpowers/specs/` |
| 实施计划 | `docs/superpowers/plans/` |
| 难以逆转的架构决策 | `docs/adr/` |

发生冲突时按以下顺序处理：

```text
经过验证的代码和测试
> 已确认 PRD
> 已确认设计
> CONTEXT.md 领域语言
> 实施计划
> 长期建设蓝图
```

发现文档与真实行为不一致时，应在同一任务中修正文档。

## Matt Pocock 项目配置

### Issue 管理

使用本地 Markdown：

```text
.scratch/<feature>/
├─ PRD.md
├─ status.md
└─ issues/
   └─ NN-<slug>.md
```

该目录不提交 Git。任务完成前，应把长期有效的信息沉淀到 `CONTEXT.md`、
`docs/`、源代码或测试中。

### Triage 分类

每个 Issue 有一个类别：

- `bug`
- `enhancement`

每个 Issue 有一个状态：

- `needs-triage`
- `needs-info`
- `ready-for-agent`
- `ready-for-human`
- `wontfix`

只有 `ready-for-agent` 状态的 Issue 才能进入自主开发。

### 领域文档

ARC.ONE 当前是单上下文仓库：

- `CONTEXT.md` 只保存领域词汇。
- ADR 按需创建在 `docs/adr/`。
- 技术栈、计划和临时任务不得写入 `CONTEXT.md`。

## 功能生命周期

### 1. 使用 `grill-with-docs` 澄清

当功能、计划或领域边界仍不清晰时使用。

该 Skill 组合：

- `grilling`：一次只问一个问题，并给出推荐答案。
- `domain-modeling`：明确标准术语，并在结论形成时更新 `CONTEXT.md`。

只有同时满足以下三个条件时才创建 ADR：

1. 决策很难逆转。
2. 缺少背景时会让后续读者感到意外。
3. 确实比较过有意义的替代方案。

阶段产出：

- 共同理解。
- 更新后的领域词汇。
- 必要的 ADR。

### 2. 使用 `to-prd` 形成 PRD

`to-prd` 不重新访谈，而是汇总已经形成的上下文。

PRD 包含：

- 问题陈述（Problem Statement）。
- 解决方案（Solution）。
- 完整的用户故事（User Stories）。
- 实施决策（Implementation Decisions）。
- 测试决策（Testing Decisions）。
- 范围外事项（Out of Scope）。
- 补充说明（Further Notes）。

发布前，应确定尽可能高层且数量尽可能少的测试接缝，并与用户确认。

保存位置：

```text
.scratch/<feature>/PRD.md
```

### 3. 使用 `to-issues` 拆分

把 PRD 拆成 tracer bullet 式端到端 Issue。

每个 Issue 必须：

- 提供一条窄而完整的用户价值路径。
- 在需要时贯穿契约、API、持久化、界面和测试。
- 独立可演示或可验证。
- 使用 `CONTEXT.md` 中的标准术语。
- 明确阻塞关系。
- 避免写入很快会过期的文件路径和实现代码。

发布前，先向用户展示 Issue 列表，确认粒度和依赖关系。

Issue 模板：

```markdown
# 标题

Category: enhancement
Status: needs-triage
PRD: `../PRD.md`

## 建设内容（What to build）

一项端到端行为。

## 验收标准（Acceptance criteria）

- [ ] 可观察的结果。
- [ ] 边界或失败场景。

## 前置依赖（Blocked by）

Issue 引用，或 `None - can start immediately`。

## 处理记录（Comments）
```

### 4. 使用 `triage` 评估

Triage 流程：

1. 阅读完整 Issue 和已有记录。
2. 搜索代码库，确认是否重复或已经实现。
3. 检查是否存在历史拒绝记录。
4. 推荐类别与状态。
5. 验证问题或需求陈述后再生成 Agent Brief。
6. 信息不完整时，使用 `grilling` 和 `domain-modeling` 继续澄清。

本地 Markdown 的 Triage 过程记录在 `## 处理记录（Comments）` 下。

只有满足以下条件才能标记为 `ready-for-agent`：

- 结果可以观察。
- 范围边界明确。
- 验收标准可测试。
- 上下文和依赖已经具备。
- 不再需要产品、安全或架构判断。

### 5. 使用 `superpowers:brainstorming` 完成设计

设计未获确认前，不编写生产代码。

设计过程：

1. 阅读当前项目上下文。
2. 一次只询问一个问题。
3. 给出 2-3 种方案、取舍和推荐。
4. 覆盖架构、数据流、异常处理和测试。
5. 将确认后的设计写入：

```text
docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md
```

6. 检查占位符、矛盾、范围和歧义。
7. 等待用户审阅后再进入实施计划。

### 6. 使用 `superpowers:writing-plans` 编写计划

计划保存到：

```text
docs/superpowers/plans/YYYY-MM-DD-<feature>.md
```

计划必须：

- 点名准确文件。
- 拆成约 2-5 分钟的动作。
- 给出实际测试和实现内容。
- 给出准确命令及预期结果。
- 遵循 DRY、YAGNI、TDD 和频繁提交。
- 不出现 `TBD`、笼统错误处理或未明确的测试任务。

### 7. 使用 Superpowers TDD 开发

每项行为变化都遵循：

```text
RED
编写一个聚焦的测试并运行。
确认它因目标行为尚未实现而失败。

GREEN
编写使测试通过的最小生产代码。
运行并确认测试通过。

REFACTOR
在全部测试保持通过的前提下改进结构和命名。
```

处理缺陷时，先使用 `superpowers:systematic-debugging`，再进入 RED。

### 8. 使用 `superpowers:verification-before-completion` 验证

不能根据代码阅读或以前的命令宣称完成，必须获得本轮的新证据。

当前最低检查：

```powershell
npm run lint
npm run build
```

加入测试基础设施后，还必须运行：

- 聚焦单元测试。
- 完整单元和集成测试。
- 用户路径浏览器 E2E。
- 涉及布局时的浏览器视觉检查。

将新的命令证据记录在 Issue 的 `## 处理记录（Comments）` 中。

### 9. 使用 `handoff` 交接

需要由其他会话或 Agent 继续时，使用 Matt Pocock 的 `handoff`。

Handoff 文档：

- 写到操作系统临时目录，不写入项目仓库。
- 引用 PRD、Issue、设计、计划、提交和 Diff，不重复大段内容。
- 推荐下一会话需要使用的 Skills。
- 删除密钥和个人敏感信息。

长期有效的结论仍应写入项目文档，不能只存在临时 Handoff 中。

## 完成定义

Issue 只有满足以下条件才能完成：

- 验收标准全部确认。
- 目标行为的测试在实现前曾正确失败。
- 聚焦测试和回归测试通过。
- Lint 和构建通过。
- 涉及界面时完成用户可见行为验证。
- Issue 中记录新的验证证据。
- 当前实现说明保持准确。
- 必要时更新领域术语或 ADR。
- 功能状态指向下一项 Issue。

## 当前管理中的功能

```text
.scratch/platform-foundation/
```

其中包含 V0.2 持久化基础 PRD 和 4 个候选端到端 Issue。在用户确认拆分粒度
和依赖顺序前，它们保持 `needs-triage`。

