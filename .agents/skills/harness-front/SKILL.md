---
name: harness-front
description: Frontend 语言规范包 — 编码规范、工程结构、支持 Vue 3 + Vite/React + Vite/Next.js/Angular/Svelte/Nuxt 等框架（SDD-TDD/开发流程/运行时可靠性共享自 harness-core）
---

# Harness Front — 前端语言规范包

本包为前端项目提供完整的 Harness 开发规范体系，支持 Vue 3 + Vite、React + Vite、Next.js、Vue 3 + Vue CLI（Webpack）、Angular、Svelte + Vite、Nuxt、React + CRA（Webpack）、纯 Vite 等框架，基于：

- **状态管理**: Pinia / Redux / NgRx / Zustand（框架自选）
- **UI 库**: Element Plus / Arco Design / Ant Design / Tailwind CSS（项目自选）
- **CSS 方案**: Tailwind CSS / Less / Sass（项目自选）
- **测试框架**: Vitest + @vue/test-utils + jsdom / React Testing Library / Angular TestBed
- **代码规范**: ESLint + Prettier + TypeScript 严格模式
- **HTTP 请求**: Axios / fetch 封装
- **构建工具**: npm / pnpm / yarn

包含 rules（3 个语言特有 + 2 个通用来自 harness-core）和 skills（9 个），与 `apply-harness` 入口技能配合使用。

> **辅助技能**: `/harness-me`（需求打磨）、`domain-modeling`（领域语言维护）、`research`（外部事实查证）、`resolving-merge-conflicts`（合并冲突解决）、`/diagnosing-bugs`（Bug 诊断）、`/handoff`（上下文交接）、`/arch-review`（架构体检）——在流水线各阶段按需调用。