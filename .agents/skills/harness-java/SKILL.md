---
name: harness-java
description: Java 语言规范包 — 编码规范、工程结构（SDD-TDD/开发流程/运行时可靠性共享自 harness-core）
---

# Harness Java — Java 语言规范包

本包为 Java 项目提供完整的 Harness 开发规范体系，基于：

- **基线框架**: Spring Boot / Spring MVC / Quarkus / Micronaut / Vert.x / Dropwizard / Dubbo / Spring Cloud Alibaba / Spring AI / Spring AI Alibaba / AgentScope Java / LangChain4j / Semantic Kernel / Genkit Java（JDK 21 LTS）
- **构建工具**: Maven 3.9+ / Gradle 8+
- **测试框架**: JUnit 5 + Mockito + AssertJ
- **代码规范**: 阿里巴巴 Java 开发手册 + Checkstyle + PMD + SpotBugs
- **架构约束**: ArchUnit

包含 rules（2 个语言特有 + 3 个通用来自 harness-core）和 skills（9 个），与 `apply-harness` 入口技能配合使用。

> **辅助技能**: `/harness-me`（需求打磨）、`domain-modeling`（领域语言维护）、`research`（外部事实查证）、`resolving-merge-conflicts`（合并冲突解决）、`/diagnosing-bugs`（Bug 诊断）、`/handoff`（上下文交接）、`/arch-review`（架构体检）——在流水线各阶段按需调用。