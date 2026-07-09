# ARC.ONE 项目说明

## 项目定位

ARC.ONE 是面向企业的 Agentic Workflow 操作系统，用于管理 Agent 资产、工作流编排、结构化产出物、质量评估、人工审核、运行观测与持续优化。

当前项目不是单纯的 Agent 搭建器，也不是只有拖拽画布的原型。它的目标是让企业把 Agent 能力纳入可版本化、可追溯、可审核、可评估的业务工作流。

## 当前阶段

当前产品迭代口径是 V1.0 Lite：轻量可运行版。

当前 `master` 已归并 `codex/v0.7a-identity-access`，实现基线包含 V0.7A 到 V0.31F 的连续实现与 V1.0 Lite 交付包。分支差异和归并背景见 `docs/project-management/branch-audit.md`。

已经从早期高保真前端原型推进到 React 单页应用 + FastAPI + SQLAlchemy 的可运行原型。Agent、工作流、运行实例、节点运行、产出物版本、Human Task、审核决定、审计事件和反馈数据已经接入本地 API 与默认 SQLite。

V1.0 Lite 不等同于企业生产版 V1.0；后者仍需要正式权限治理、生产迁移、备份恢复、可观测性和部署验证。

## 核心用户

| 用户 | 主要诉求 |
|---|---|
| AI 建设者 | 创建 Agent、配置工作流、发布稳定版本 |
| 工作流设计者 | 编排节点、校验 DAG、设置 Human 节点和质量路由 |
| 运行观察者 | 查看工作流运行、节点状态、产出物、Token 和成本 |
| 审核人 | 认领人工任务、查看上下文、提交审核决定 |
| 质量负责人 | 复盘人工修改、沉淀反馈候选和 Golden Sample |
| 平台维护者 | 管理契约、权限、审计、测试和版本演进 |

## 能力地图

| 能力域 | 当前状态 | 说明 |
|---|---|---|
| Agent 生命周期 | 已实现 | 草稿编辑、不可变版本、历史版本、停用、测试运行 |
| 工作流生命周期 | 已实现 | 草稿保存、DAG 校验、Agent 版本引用、不可变发布 |
| 真实 Agent 执行 | 已实现基础闭环 | OpenAI-compatible ModelGateway、FakeGateway 测试、DeepSeek 联调 |
| 运行中心 | 已实现基础查询 | 持久化 Run、NodeRun、Artifact，前端读取真实 API |
| 人工协作 | 已实现 V0.6 | Human 节点暂停、认领、会签、SLA、恢复、重跑、终止 |
| 反馈闭环 | 已实现 V0.6 | 修改后通过生成 FeedbackCandidate，专家确认 Golden Sample |
| 评估中心 | 局部原型 | Rubric 展示仍以演示数据为主，评价器和回归任务未真实接入 |
| 身份与权限 | 正在推进 V0.7A | 已有设计和实施计划，当前 tracker 不完整，只有首个 issue 有记录 |
| Schema / Data Object | 局部推进 | 有字段映射和字段选择器需求，尚未成为完整资产中心 |
| 可观测性 | 待建设 | 缺少实时推送、Trace、日志查询、运行回放和告警 |

## 架构概览

```text
浏览器
→ React / React Router / React Flow
→ 平台 HTTP API
→ FastAPI + SQLAlchemy
→ SQLite，本地可通过 DATABASE_URL 切换 PostgreSQL
→ ModelGateway / FakeGateway
```

当前架构仍是单体 API 与单页应用，适合继续验证产品闭环和领域模型。Temporal、LangGraph、独立评估服务、对象存储、向量库和生产级观测系统仍属于后续阶段。

## 已实现边界

- 数据已经不再全部来自前端 mock；Agent、工作流、运行中心和人工审核已接入真实 API。
- 评估中心和运营总览仍有演示数据。
- API Key 只允许保存在本地被忽略的环境文件或环境变量中，不能进入前端、数据库、仓库和响应。
- 当前 SQLite 迁移是轻量增量迁移，不等同于生产级跨数据库迁移体系。
- 目前还没有登录、完整 RBAC、企业 SSO、外部通知发送和后台任务队列。

## 项目管理方式

项目采用两条互补链路：

- Matt Pocock Skills：管理领域语言、PRD、Issue、Triage 和 Handoff。
- Superpowers：管理设计确认、实施计划、TDD、系统调试和完成验证。

核心文件入口：

| 信息 | 位置 |
|---|---|
| 领域语言 | `CONTEXT.md` |
| 当前实现 | `docs/CURRENT_IMPLEMENTATION.md` |
| 分支事实 | `docs/project-management/branch-audit.md` |
| 开发流程 | `docs/PROJECT_WORKFLOW.md` |
| 长期蓝图 | `docs/PROJECT_MASTER_PLAN.md` |
| 项目级管理 | `docs/project-management/` |
| 本地功能 PRD/Issue | `.scratch/<feature>/` |
| 设计与实施计划 | `docs/superpowers/` |
