# 05/06 运行与闭环迁移

Status: ready-for-human

用户已确认 `docs/superpowers/specs/2026-09-06-netlify-runtime-closure-design.md`。
目标：以 PG 持久化业务状态和 AWL 唤醒接缝迁移执行、通知、调度、人审、评估、整改、产出物及追踪。
长操作 202，外部结果不确定暂停自动重放。沿用现有授权/审计/Workspace 边界。
生产保持休眠，未授权发布或切流；不得读取凭证、运行真实模型或真实通知。
AC 与第一性原理、对抗式审查风险详见已确认设计；所有未验证项保持未完成。

本地实现与两轴审查完成，Spec/Standards 未解决严重问题 0。12 个运行验证程序、
5 条 Chromium、最终前端 68 文件 677 项、lint/build/deploy:check 已通过。
验收范围为本地工程；两次间歇测试占用如实保留，最终重放完整通过，不宣称工具链根因已修复。
详情见 `verify.md`、`review.md` 和两个独立轴报告；后续为云端装配和上线验收，不是关闭 Zeabur。
