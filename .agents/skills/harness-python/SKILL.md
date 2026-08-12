---
name: harness-python
description: Python 语言规范包 — 编码规范、工程结构（SDD-TDD/开发流程/运行时可靠性共享自 harness-core）
---

# Harness Python — Python 语言规范包

本包为 Python 项目提供完整的 Harness 开发规范体系，基于：

- **基线框架**: Django / FastAPI / Flask / Tornado / TensorFlow / PyTorch / Keras / scikit-learn / XGBoost / LangChain / LangGraph / CrewAI / PydanticAI / SmolAgents / OpenAI Agents SDK / Hugging Face Transformers
- **运行时**: Python 3.11+
- **测试框架**: pytest + pytest-mock
- **代码规范**: PEP 8 + Google Python Style + flake8 + mypy + black + isort
- **依赖管理**: pip + virtualenv / poetry / uv

包含 rules（2 个语言特有 + 3 个通用来自 harness-core）和 skills（9 个），与 `apply-harness` 入口技能配合使用。

> **辅助技能**: `/harness-me`（需求打磨）、`domain-modeling`（领域语言维护）、`research`（外部事实查证）、`resolving-merge-conflicts`（合并冲突解决）、`/diagnosing-bugs`（Bug 诊断）、`/handoff`（上下文交接）、`/arch-review`（架构体检）——在流水线各阶段按需调用。