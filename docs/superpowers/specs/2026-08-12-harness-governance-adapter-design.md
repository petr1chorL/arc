# Harness 双栈治理适配设计

## 背景

ARC.ONE 已有明确的项目事实层和开发生命周期。Harness 默认模板提供 Owner、规则、技能、变更与
Wiki，但默认只选择一个焦点语言，并假设一组当前仓库并未使用的工具和目录。

## 方案选择

### 方案 A：按前端模板直接应用

优点是简单；缺点是忽略 FastAPI，并把 Vue/ESLint 等模板假设带入 React/Oxlint 项目。

### 方案 B：前后端各建一套 Harness

能保留语言差异，但会形成两个 Owner、两套变化追踪和两个知识入口，不适合当前单仓库单上下文。

### 方案 C：一个双栈执行层，引用现有事实体系

用一个 Owner 编排双栈，在规则内按影响面选择命令；变化追踪、Wiki、Context 和 Skills 都只保存
导航或回执。该方案最少改变现有治理结构，选用此方案。

## 信息架构

```text
项目事实与决策
├─ AGENTS.md / docs/PROJECT_WORKFLOW.md
├─ docs/project-management/project-overview.md
├─ CONTEXT.md / docs/adr/
└─ .scratch/<feature>/ PRD + Issue
             ↓ 引用
.harness 执行层
├─ agents/owner.md
├─ rules/
├─ changes/_TEMPLATE/（执行回执）
├─ wiki/（导航）
├─ CONTEXT.md（重定向）
└─ skills/README.md（指向 .agents/skills）
```

## 双栈参数

| 维度 | 前端 | 后端 |
|---|---|---|
| 技术栈 | React 19、TypeScript 6、Vite 8 | Python 3.12、FastAPI、SQLAlchemy |
| 测试 | Vitest、Testing Library、Playwright | pytest |
| 静态门禁 | Oxlint、TypeScript build | pytest 与 Python 导入/启动相关测试 |
| 数据 | 浏览器调用 `src/api/` | SQLite/PostgreSQL |

## 关键约束

- `.harness` 不能覆盖经过验证的代码、项目总览、PRD、设计、领域语言或实施计划。
- 不引入模板中不存在于当前仓库的工具。
- 不强制棕地代码迁移目录，只约束新增代码遵循现有接缝。
- 产品能力声明仍以项目总览和本轮验证为准。

## 第三方 Skill 供应链边界

`.agents/skills/` 作为供应商快照与 `skills-lock.json` 一并保留，项目适配不直接改写其中内容。
安装不等于授权：会联网、覆盖配置、向仓库外注册、探测凭证环境变量、启动部署，或仍含
`{{...}}` 的指令都默认不可执行。当前只启用与 React/FastAPI 事实匹配的 front、python 和
适用 core 能力，完整审查记录见 `docs/security/third-party-harness-skills-review.md`。

## 验证

通过文本完整性、路径/命令存在性、错误模板术语扫描、第三方 Skill 离线静态审查、lint、build
和 diff check 验证。
