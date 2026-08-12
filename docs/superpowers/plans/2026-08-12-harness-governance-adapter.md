# Harness 双栈治理适配实施计划

1. 建立本地 PRD/Issue 与设计记录
   - 验证：第一性原理、范围、验收标准和对抗式审查齐全。
2. 创建 `.harness` Owner、规则和导航
   - 验证：只引用真实技术栈、目录、命令和项目事实入口。
3. 创建变化回执模板
   - 验证：模板必须引用 `.scratch/<feature>/PRD.md` 与具体 Issue，不复制独立规格状态机。
4. 将 Harness 执行入口接入 `docs/PROJECT_WORKFLOW.md`
   - 验证：明确 `.harness` 不改变既有信息源优先级。
5. 执行对抗式检查和工程门禁
   - 验证：占位符/错误技术栈扫描、路径与 script 检查、`npm run lint`、`npm run build`、
     `git diff --check` 全部通过。
6. 审查并锁定第三方 Harness Skills
   - 验证：盘点可执行内容、联网/覆盖/凭证/部署指令和未渲染模板；将项目级执行边界写入
     `AGENTS.md` 与 `.harness/skills/README.md`，保留 `skills-lock.json` 作为来源记录。
