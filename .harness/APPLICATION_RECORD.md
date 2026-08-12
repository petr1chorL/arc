# Harness 应用记录

- 应用日期：2026-08-12
- 项目：ARC.ONE（`arc-one-agentic-os` / `arc-one-api`）
- 模式：受控双栈适配
- 前端：React 19 + TypeScript 6 + Vite 8
- 后端：Python 3.12 + FastAPI + SQLAlchemy

## 相对默认模板的显式调整

- 多语言项目不二选一，使用一个双栈 Owner，按改动影响面选择门禁。
- 不复制 Vue 目录规范，不引入 ESLint/Prettier；前端沿用 Oxlint 与 TypeScript build。
- 不引入 flake8/mypy/black/isort/Alembic；后端沿用当前 pytest 与既有目录。
- 不复制 Skills；沿用 `.agents/skills/` 已安装版本。
- 把 `.agents/skills/` 作为锁定供应商快照；联网、覆盖、凭证探测、部署和未渲染模板默认禁用。
- 不建立第二套 PRD/Issue、领域语言或 ADR；只导航现有入口。

## 第一性原理核查

Harness 的价值是降低执行偏差。对一个已有成熟治理体系的棕地项目，最少必要对象是执行编排、
双栈规则和验证回执；复制所有模板会增加冲突面而不是增加约束力。

## 对抗式审查

- `.harness` 存在不代表所有建议都有 CI 自动守护。
- 本次没有改变业务代码、权限、审计、Workspace 隔离、数据或生产部署。
- 本次没有证明 ARC.ONE 已达到生产级高可用、完整外部集成或业务验收完成。
- 后续若规则与真实代码、测试或项目总览冲突，必须修正规则，不能为满足规则而歪曲事实。

## Skills 注册

跳过。项目 Skills 已安装在 `.agents/skills/`，重复复制会产生版本漂移。
