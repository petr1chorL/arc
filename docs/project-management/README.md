# ARC.ONE 项目管理文档

本目录保存项目级管理文档，用于回答“项目是什么、做到哪、接下来做什么”。

## 文档索引

| 文档 | 作用 | 更新时机 |
|---|---|---|
| `project-overview.md` | 唯一当前事实入口、能力地图与优先级 | 每次重要实现、验证或部署状态变化后 |
| `roadmap.md` | 版本规划与阶段依赖 | 新版本立项、范围调整或验收后 |
| `version-ledger.md` | 已完成版本台账和证据 | 每个版本验收或状态修正后 |
| `iteration-backlog.md` | 本地 PRD/Issue 汇总 | `.scratch/` 需求包新增、关闭或重排后 |
| `source-audit.md` | 源码能力与文档偏差盘点 | 重要版本切换或发现文档失真后 |
| `branch-audit.md` | 本地分支差异与高级分支事实 | 发现未归并分支或版本事实冲突后 |

## 使用原则

- `project-overview.md` 是项目级唯一当前事实入口。
- `docs/CURRENT_IMPLEMENTATION.md` 保存详细实现说明和历史版本记录，不单独决定当前优先级。
- `.scratch/<feature>/` 是本地功能级 PRD、Issue 和处理记录，默认不受 Git 跟踪。
- `.scratch/` 中长期有效的结论必须沉淀到受 Git 跟踪的文档、源码或测试。
- 本目录只做项目级汇总，不替代具体 PRD、Issue、设计或测试证据。
- 规划项必须标明状态，不能把后续规划描述成已经实现。
- 源码盘点结论优先用于修正文档偏差，但不能替代正式验收。
- 存在分支差异时，先看 `branch-audit.md`，再回到 `project-overview.md` 更新当前结论。
