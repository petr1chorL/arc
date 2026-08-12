---
id: H-20260812-01
status: ready-for-human
feature: .scratch/harness-governance-adapter/
prd: .scratch/harness-governance-adapter/PRD.md
issue: .scratch/harness-governance-adapter/issues/01-apply-controlled-harness.md
design: docs/superpowers/specs/2026-08-12-harness-governance-adapter-design.md
plan: docs/superpowers/plans/2026-08-12-harness-governance-adapter.md
---

# 执行回执：应用受控双栈 Harness 执行层

## 当前阶段

- 阶段：ready-for-human
- 下一门禁：维护者审阅新增规范是否符合团队预期。

## 影响面

- 前端：不改业务代码；规则映射 React、Vitest、Oxlint、TypeScript/Vite 命令。
- 后端：不改业务代码；规则映射 Python 3.12、FastAPI、SQLAlchemy、pytest 命令。
- 契约/数据：无变化。
- 安全/隔离/审计：保留现有 Workspace、Secret Ref、出口和失败关闭边界。
- 文档：新增 `.harness/` 执行层、设计/计划、第三方 Skill 审查，并在项目流程增加入口。

## RED / GREEN 证据

- RED：不适用；本次是纯治理文档，不改变运行行为。
- GREEN：不适用；以文本完整性、真实路径/命令和工程门禁验证。

## 验证证据

| 命令或检查 | 结果 | 说明 |
|---|---|---|
| 占位符与错误模板术语扫描 | 通过 | 20 个非模板文件无双花括号占位符；风险工具只出现在明确不采用说明中 |
| 路径与 package scripts 检查 | 通过 | 15 个关键路径、6 个 scripts 与后端清单证据通过 |
| `npm run lint` | 通过 | Oxlint 退出码 0 |
| `npm run build` | 通过 | 沙箱外重跑成功；保留既有大 Chunk 警告 |
| `npm test -- --run` | 通过 | 第二次全量重跑 46 个文件、285 项通过；首次单个时序失败已单独复核通过 |
| Python 3.12 后端 pytest | 环境受阻 | 依赖可导入；pytest setup 被运行环境临时目录 ACL 拒绝，本次未改后端源码 |
| 第三方 Skill 离线审查 | 通过 | 80 个 Markdown/YAML 文件，无脚本/二进制/硬编码凭证；高权限路径默认禁用 |
| `git diff --check` | 通过 | 仅有 LF/CRLF 转换提示 |

## 遗留人工动作

- 在临时目录 ACL 正常的环境重跑 Python 3.12 后端全量 pytest；当前不可误报为已通过。
