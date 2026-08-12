---
name: arch-review-python
stage: 架构体检
description: 扫描代码库，发现架构摩擦点，生成可视化报告，逐一打磨改进方案。
disable-model-invocation: true
---

# 架构体检技能（Architecture Review）— Python 版

> 扫描代码库，发现"浅模块"，生成可视化 HTML 报告，然后逐个打磨改进方案。

---

## 1. 工作流程

### Step 1: 探索

**先确定范围再扫描——YAGNI。** 关注最近频繁变更的模块。

- 如果用户指定了方向，直接使用
- 否则，用 `git log --oneline` 找热点区域

关注以下摩擦信号：

| 信号 | 说明 |
|------|------|
| **浅模块** | 接口几乎和实现一样复杂——模块没有真正隐藏复杂性 |
| **耦合过深** | 理解一个概念需要跳转多个小模块 |
| **接缝缺失** | 核心逻辑无法通过当前接口直接测试 |
| **测试困难** | 需要复杂的 `mocker` 和 `monkeypatch` 才能测简单逻辑 |

### Step 2: 生成 HTML 报告

写入 OS 临时目录，使用 **Tailwind CDN** + **Mermaid CDN**。

每个候选问题一张卡片，包含：
- **涉及文件** — 哪些文件/模块
- **问题** — 为什么当前架构有摩擦
- **方案** — 浅显易懂的改进描述
- **Before/After 图** — Mermaid 对比图
- **推荐强度** — `Strong` / `Worth exploring`

### Step 3: 打磨循环

用户选择后，运行 `/harnessing-python` 技能，沿决策树推进。

---

## 2. 对 Python 项目的特别关注点

- **分层依赖** — handler → service → model 方向是否正确？
- **导入关系** — 是否有循环 import？
- **Flask/FastAPI 入口** — 是否有胖 handler 反模式？
- **{{ORM_TOOL}} 模型** — 是否有业务逻辑泄漏到模型层？