# ARC.ONE Agentic OS

面向企业 AI 工作流设计、执行、评估、人工协作和运行治理的平台。

## 当前状态

当前版本是高保真前端 MVP，用于验证产品信息架构和核心交互。

已实现：

- 运营总览
- 工作流 DAG 编排
- Agent 资产管理
- Rubric 与质量门禁
- 运行实例追踪
- 人工审核工作台
- 桌面端和移动端适配

尚未实现：

- 后端 API 和数据库
- 真实大模型与 Agent 执行
- 工作流调度和持久化
- 登录权限和企业治理
- 真实评估、Trace 和成本统计

当前页面数据来自 `src/data/mock.ts`。

## 项目文档

开始任何新需求前，先阅读：

- [领域上下文](CONTEXT.md)
- [项目开发与管理流程](docs/PROJECT_WORKFLOW.md)

想了解当前页面底层具体做了什么：

[阅读当前版本实现说明](docs/CURRENT_IMPLEMENTATION.md)

想了解从当前原型到企业生产平台的技术架构、开源工具和 V0-V2 版本路线：

[阅读完整项目建设蓝图](docs/PROJECT_MASTER_PLAN.md)

当前阶段的本地 PRD、Issue 和状态放在 `.scratch/`，该目录不提交 Git。

项目采用：

```text
Matt Pocock Skills：上下文、PRD、Issue、Triage、Handoff
Superpowers：Brainstorming、Plan、TDD、Debug、Verification
```

## 当前技术栈

- React 19
- TypeScript 6
- Vite 8
- React Router 7
- React Flow 12
- Lucide React
- Oxlint
- 原生 CSS

## 本地运行

```powershell
npm install
npm run dev
```

当前开发服务：

```text
http://127.0.0.1:4173
```

## 检查

```powershell
npm run lint
npm run build
```
