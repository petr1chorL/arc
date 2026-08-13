# Harness Skills 来源

项目所需 Harness Skills 已安装在 `../../.agents/skills/`：

- `harness-front`：React/Vite 前端相关执行、测试、评审和架构审查。
- `harness-python`：FastAPI/Python 后端相关执行、测试、评审和诊断。
- `harness-core`：领域建模、研究、冲突解决等通用能力。

本目录不复制 Skill 源码，也不执行重复注册。使用 Skill 时仍须服从 `AGENTS.md`、项目流程和
本项目专用 `.harness/rules/`；语言包中的 Vue、目录或工具默认值不能覆盖仓库事实。

## 执行边界

- 允许按需使用：与当前 React/FastAPI 事实匹配的 `harness-front`、`harness-python`，以及
  不含未渲染占位符且与任务相关的 `harness-core` 能力。
- 默认禁用：`apply-harness`、`install-skill`、Java/Go 语言包、部署类 Skill，以及任何仍含
  双花括号占位符的命令片段；只有用户明确授权并确认目标与差异后才能使用。
- 禁止自动联网、读取凭证环境变量、覆盖已有配置、向仓库外工具目录注册 Skill。
- 上游升级后必须重新执行离线审查，并同步 `skills-lock.json` 和审查记录。

详细审查记录见 `../../docs/security/third-party-harness-skills-review.md`。
