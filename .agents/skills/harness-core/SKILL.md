---
name: harness-core
description: Harness 核心骨架模板 — 参数化模板化技能（被 apply-harness 渲染到各语言包）+ 通用技能 + 模板
---

# Harness 核心骨架

本技能提供跨语言通用的 Harness 骨架模板与通用技能，包括：

- `agents/owner.md` — 参数化的 Owner Agent 定义（含 `{{LANGUAGE}}` 等占位符）
- `templates/changes/_TEMPLATE/` — 变更追踪模板（change.md / review.md / verify.md）
- `templates/wiki/` — 领域知识文档模板（业务模型 / 接口协议 / 数据模型 / 架构决策 / ADR-FORMAT）
- `templates/CONTEXT.md` + `CONTEXT-FORMAT.md` — 领域语言词典模板与编写规范
- `skills/` — 技能模板与跨语言通用技能
  - **模板化技能**（被 `apply-harness` 渲染到各语言包）：`harness-me` / `handoff` / `diagnosing-bugs` / `coding-skill` / `unit-test-write`，含 `{{LANG_TAG}}`、`{{BUILD_CMD}}` 等占位符
  - **跨语言通用技能**（直接复制）：`domain-modeling`（领域语言维护）/ `research`（外部事实查证）/ `resolving-merge-conflicts`（合并冲突解决）

被 `apply-harness` 技能在初始化项目时调用。