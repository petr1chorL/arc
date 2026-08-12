# ARC.ONE Harness 执行层

本目录把 Harness 的 Owner、规则和交付回执适配到 ARC.ONE 当前 React + FastAPI 双栈。
它是执行地图，不是新的项目事实入口。

## 优先级

发生冲突时按以下顺序处理：

```text
当前源码与本轮验证
> AGENTS.md 与 docs/PROJECT_WORKFLOW.md
> docs/project-management/project-overview.md
> 当前功能 PRD / Issue / 已确认设计
> CONTEXT.md
> .harness/rules/
```

`.harness/rules/` 负责把上层约束翻译成便于执行的检查表，不得改写产品范围、当前实现状态、
领域术语、Issue 状态或架构决策。

## 项目画像

| 区域 | 当前基线 | 主要验证 |
|---|---|---|
| 前端 | React 19、TypeScript 6、Vite 8 | Vitest、Testing Library、Playwright、Oxlint、TypeScript build |
| 后端 | Python 3.12、FastAPI、Pydantic、SQLAlchemy | pytest |
| 数据 | SQLite / PostgreSQL | 后端迁移、隔离和契约测试 |
| 部署 | 单容器 Nginx + FastAPI，外加 Worker 入口 | 部署检查、健康检查、必要时实时验收 |

版本与能力边界以 `docs/project-management/project-overview.md` 为准，不能由本表推导生产能力。

## 使用顺序

1. 按 `AGENTS.md` 阅读项目必读文档和当前 `.scratch/<feature>/`。
2. 读取 `.harness/agents/owner.md` 和与改动相关的规则。
3. 在 `.scratch/<feature>/` 完成 PRD、Issue、Triage、设计和计划。
4. 从 `.harness/changes/_TEMPLATE/` 创建执行回执，并引用现有 PRD/Issue。
5. 按 TDD、评审、CI 和浏览器/部署验证收口，回写 Issue 与长期文档。

## 目录职责

- `agents/owner.md`：双栈执行编排与决策边界。
- `rules/`：项目专用开发与验证规则。
- `changes/`：对现有 Issue 的执行回执，不是第二个 Issue tracker。
- `wiki/`：现有领域、接口、数据和 ADR 文档的导航。
- `CONTEXT.md`：指向根 `CONTEXT.md`，不保存重复术语。
- `skills/README.md`：指向 `.agents/skills/`，不复制或重复注册 Skills。
