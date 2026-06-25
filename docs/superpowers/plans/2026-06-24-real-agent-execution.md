# Real Agent Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 运行已发布 Agent 与工作流，持久化执行证据、成本、质量结果和人工审核任务。

**Architecture:** 可注入 ModelGateway 隔离模型供应商；同步执行服务负责拓扑排序、节点重试和状态持久化；React 页面通过真实 Run API 展示。

**Tech Stack:** FastAPI、SQLAlchemy、HTTPX、React、TypeScript、React Flow、Vitest、Pytest、Playwright

---

### Task 1: 模型网关与 Agent 测试运行

- [x] 编写 FakeGateway 驱动的失败测试。
- [x] 实现 OpenAI-compatible 网关和安全配置。
- [x] 持久化 Agent 测试运行证据。
- [x] 覆盖 Token、成本、耗时和失败重试。

### Task 2: 工作流执行与质量路由

- [x] 编写顺序执行、重试、失败和低分审核测试。
- [x] 实现 Run、NodeRun、Artifact、HumanReview 模型。
- [x] 实现拓扑执行和最终产出物。
- [x] 实现基础质量门禁和人工任务创建。

### Task 3: 前端运行体验

- [x] 增加执行 API 客户端测试。
- [x] Agent 详情增加测试运行工作台。
- [x] 工作流设计器增加运行入口。
- [x] 运行中心和人工审核切到真实 API。

### Task 4: 验证与联调

- [x] 增加跨模块浏览器执行验证。
- [x] 运行全部前后端测试、lint、build。
- [x] 验证模型服务未配置错误不泄露密钥。
- [x] 使用用户确认的供应商 Base URL 完成一次真实模型调用。
- [x] 更新中文文档。
- [ ] 提交 V0.5。
