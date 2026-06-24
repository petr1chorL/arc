# Agent and Workflow Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成 Agent 版本生命周期和工作流草稿/发布持久化。

**Architecture:** FastAPI + SQLAlchemy 保存可变草稿和不可变版本快照；React 通过类型化 API 管理详情和设计器状态；发布前由后端执行领域校验。

**Tech Stack:** React、TypeScript、React Flow、Vitest、Testing Library、FastAPI、Pydantic、SQLAlchemy、Pytest、Playwright

---

### Task 1: Agent 生命周期领域规则

- [x] 编写编辑、发布、版本不可变和停用的失败 API 测试。
- [x] 增加 Agent 草稿字段与 AgentVersion 模型。
- [x] 实现详情、编辑、发布、版本列表和停用 API。
- [x] 运行 Agent API 测试至通过。

### Task 2: 工作流领域规则

- [x] 编写草稿保存、非法 DAG 和不可变发布快照的失败测试。
- [x] 增加 Workflow 与 WorkflowVersion 模型。
- [x] 实现 DAG 与 Agent 版本引用校验。
- [x] 实现工作流 CRUD、校验和发布 API。
- [x] 运行工作流 API 测试至通过。

### Task 3: Agent 详情界面

- [x] 编写 Agent 详情 API 客户端测试。
- [x] 编写详情编辑、发布和停用组件测试。
- [x] 新增详情路由与 Soft UI 详情页。
- [x] 运行前端测试至通过。

### Task 4: 工作流持久化界面

- [x] 编写工作流 API 客户端测试。
- [x] 编写 React Flow 与领域契约适配器测试。
- [x] 将 React Flow 画布接入工作流 API。
- [x] 增加新建、切换、保存、校验、发布和版本记录。
- [x] 运行前端测试至通过。

### Task 5: 验证与文档

- [x] 增加 Agent 发布到工作流引用的浏览器测试。
- [x] 运行前后端测试、lint、build 和浏览器视觉回归。
- [x] 更新 README、当前实现说明和项目路线状态。
- [x] 提交 V0.3/V0.4 生命周期功能。
