# ARC.ONE Agent 协作规范

## 项目定位

ARC.ONE 是面向企业的 Agentic Workflow 操作系统，用于管理 Agent 资产、
工作流编排、结构化产出物、质量评估、人工审核、运行观测与持续优化。

当前仓库处于 V0.1：高保真前端原型。不得把模拟页面描述成已经具备后端、
数据库或真实 Agent 执行能力。

## 开始工作前必读

进行实质性工作前，依次阅读：

1. `CONTEXT.md`
2. `docs/PROJECT_WORKFLOW.md`
3. `docs/CURRENT_IMPLEMENTATION.md`
4. `.scratch/` 下当前功能的 PRD 与 Issue

`docs/PROJECT_MASTER_PLAN.md` 用于了解长期方向，不能直接当作开发清单。

## Agent skills

### Issue tracker

PRD 与 Issue 使用本地 Markdown，存放在 `.scratch/<feature>/`；当前没有远程
Issue 或 PR 请求入口。详见 `docs/agents/issue-tracker.md`。

### Triage labels

项目直接使用 Matt Pocock 的五种标准状态，不做重命名。详见
`docs/agents/triage-labels.md`。

### Domain docs

当前为单上下文仓库：领域词汇位于根目录 `CONTEXT.md`，满足条件的 ADR
按需创建在 `docs/adr/`。详见 `docs/agents/domain.md`。

## 功能管理要求

每项功能必须具备：

1. 范围明确的 PRD。
2. 按端到端用户价值拆分的 Issue。
3. 可验证的验收标准。
4. 开发前经过 Superpowers 设计与实施计划。
5. 完成前具有新的验证证据。

## 开发生命周期

Matt Pocock Skills 负责上下文和项目管理：

```text
grill-with-docs
-> to-prd
-> to-issues
-> triage
-> handoff
```

Superpowers 负责开发纪律：

```text
superpowers:brainstorming
-> superpowers:writing-plans
-> superpowers:test-driven-development
-> 实现
-> superpowers:verification-before-completion
```

处理缺陷时，先使用 `superpowers:systematic-debugging`，再进入 TDD。

## 执行原则

- 优先提交小而易审查的改动。
- 编辑前点名文件，并给出 3-6 条计划。
- 不虚构 API、配置或路径；不确定时先搜索。
- 保持现有架构和代码风格。
- 行为变化必须增加或更新测试。
- 优先使用类型约束和显式错误处理。
- 不读取或输出密钥、Token、私钥和 `.env` 值。
- 未经要求，不增加遥测、分析或外部网络调用。
- 先运行最快的相关检查，再做完整验证。
- 项目文档和解释默认使用中文。
- Skill 名、代码标识、状态值和必要专业术语可保留英文。

## 完成定义

任务只有满足以下条件才算完成：

- Issue 验收标准已逐项确认。
- 行为测试在实现前曾因目标行为缺失而失败。
- 相关测试全部通过。
- `npm run lint` 通过。
- `npm run build` 通过。
- 涉及界面时完成浏览器验证。
- Issue 状态和相关文档已更新。
- 不把规划能力误报为已实现能力。

