---
name: install-skill
description: 将 .harness/skills/ 下的技能注册到当前 AI 工具（reasonix / claude-code / cline / cursor / codex / qoder / trae / codebuddy / lingma / windsurf / copilot 等 19+ 工具）可识别的技能目录，使 /harnessing、/harness-me 等斜杠命令立即可用
---

# Install Skill — 一键注册技能到当前工具

> 在**目标项目根目录**执行此命令，自动将 `.harness/skills/` 下的技能安装到当前 AI 工具可识别的技能目录，让 `/harnessing`、`/harness-me`、`/coding-skill` 等斜杠命令立即生效。

---

## 为什么需要这个命令？

`/apply-harness` 只负责把技能文件**复制**到 `.harness/skills/`，但各 AI 工具**不会自动扫描** `.harness/` 目录来注册斜杠命令。本命令把技能**注册**到工具真正扫描的技能目录。

## 工作流程

### Step 1: 检测当前 AI 工具

按优先级检测当前运行的 AI 工具，将技能安装到对应目录：

| 工具 | 检测依据 | 技能安装目录 | 兼容性说明 |
|------|---------|-------------|-----------|
| **Reasonix** | 存在 `.reasonix/` 目录 或 `REASONIX` 环境变量 | `.reasonix/skills/` | ✅ 原生 SKILL.md |
| **Claude Code** | 存在 `.claude/` 目录 或 `CLAUDE_CODE` 环境变量 | `.claude/skills/` | ✅ 原生 SKILL.md |
| **Cline / Roo Code** | 存在 `.cline/` 或 `.clinerules/` 目录 | `.cline/skills/` 或 `.claude/skills/` | ✅ 兼容 `.claude/skills/` |
| **Cursor** | 存在 `.cursor/` 目录 | `.cursor/skills/` | ✅ 原生 SKILL.md |
| **Codex (OpenAI)** | 存在 `.codex/` 目录 或 `OPENAI_API_KEY` 环境变量 | `.codex/skills/` | ✅ 原生 SKILL.md |
| **Qoder** | 存在 `.qoder/` 目录 | `.qoder/skills/` | ✅ 完全兼容 SKILL.md |
| **VS Code Agent Skills** | 存在 `.vscode/` 目录（VS Code 1.98+） | `.vscode/agent-skills/` | ✅ 通过 VS Code Agent Skills 标准 |
| **Amazon Q Developer** | 存在 `.qdeveloper/` 或通过 VS Code 代理 | `.github/copilot-instructions.md` 或 `.vscode/agent-skills/` | ⚠️ 通过 VS Code Agent Skills 间接兼容 |
| **Windsurf** | 存在 `.windsurf/` 目录 | `.windsurf/workflows/`（需手动映射命令） | ⚠️ 非 SKILL.md 原生 |
| **Continue.dev** | 存在 `.continue/` 目录 | `.continue/skills/`（通过 config.yaml 注册） | ⚠️ 部分兼容 SKILL.md |
| **GitHub Copilot** | 存在 `.github/` 目录 | `.github/skills/` | ⚠️ 部分兼容（Cloud Agent） |
| **OpenCode** | 存在 `.opencode/` 目录 | `.opencode/commands/`（每命令一个 .md 文件） | ⚠️ 有独立命令体系 |
| **Trae** | 存在 `.trae/` 目录 | `.trae/rules/`（非 SKILL.md 原生） | ⚠️ 有独立规则体系 |
| **CodeBuddy** | 存在 `.codebuddy/` 目录 | `.codebuddy/`（路径待确认） | ⚠️ 兼容性未确认 |
| **通义灵码 (Tongyi Lingma)** | 存在 `.lingma/` 目录 | `.lingma/`（路径待确认） | ⚠️ 兼容性未确认 |
| **CodeGeeX** | 存在 `.codegeex/` 目录 | `.codegeex/`（路径待确认） | ⚠️ 兼容性未确认 |
| **Tabnine** | 存在 `.tabnine/` 目录 | `.tabnine/guidelines/` | ⚠️ 使用 guidelines.md 替代 SKILL.md |
| **Sourcegraph Cody** | 存在 `.cody/` 目录 | `.cody/`（路径待确认） | ⚠️ 兼容性未确认 |
| **MarsCode** | 存在 `.mars/` 目录 | `.mars/`（已合并到 Trae） | ⚠️ 兼容性未确认 |

> **检测逻辑**：按上表顺序检测，优先选择 ✅ 标记的工具（原生 SKILL.md 兼容），其次 ⚠️ 标记的工具。选择第一个匹配的目录。若都不匹配，提示用户手动指定目录，或回退到 `npx skills` CLI 安装。

### Step 2: 定位技能来源

扫描项目根目录下的 `.harness/skills/`，收集所有包含 `SKILL.md` 的技能目录：

```
.harness/skills/
├── {lang}/          # 语言特有技能（harnessing、harness-me、coding-skill...）
└── common/          # 跨语言通用技能（domain-modeling、research、resolving-merge-conflicts）
```

### Step 3: 安装技能

对每个含 `SKILL.md` 的技能目录 `<skill-name>`，按工具兼容性采取不同方式：

**✅ 原生 SKILL.md 工具**（Reasonix、Claude Code、Cline、Cursor、Codex、Qoder、VS Code Agent Skills）
1. **复制**到目标工具目录：`<工具目录>/<skill-name>/`（完整复制目录，含全部文件）
2. 保持 `SKILL.md` 的 frontmatter `name` 不变——斜杠命令名即来自它
3. 若目标已存在同名技能，**覆盖**（或询问用户是否覆盖）

**⚠️ 非原生工具**（Windsurf、OpenCode、Trae、CodeBuddy、通义灵码、CodeGeeX、Tabnine、Cody、MarsCode 等）
- 优先尝试将技能复制到对应目录（如 `.trae/rules/`、`.opencode/commands/`）
- 若工具不支持 SKILL.md 格式，将技能内容转换为该工具支持的格式（如 Tabnine 的 `guidelines.md` 或 OpenCode 的独立命令 .md 文件）
- 若无法自动转换，**提示用户手动配置**并给出配置指引

### Step 4: 输出安装摘要

```
╔══════════════════════════════════════════╗
║   ✅ 技能已安装到 <工具名>               ║
╠══════════════════════════════════════════╣
║  目标目录: .reasonix/skills/             ║
║  已安装:   N 个技能                       ║
║  /harnessing        ✅ 可调用             ║
║  /harness-me        ✅ 可调用             ║
║  /coding-skill      ✅ 可调用             ║
║  ...                                    ║
╚══════════════════════════════════════════╝
```

> 提示：若工具未即时刷新，重启会话或重新加载即可看到新斜杠命令。
> **Claude Code 用户注意**：若 `.claude/skills/` 未自动将技能暴露为斜杠命令，请在 `.claude-plugin/plugin.json` 的 `skills` 数组中添加对应路径，或通过 `.claude/commands/` 目录注册。
> **Cline 用户注意**：Cline 兼容 `.claude/skills/` 目录，技能安装到 `.claude/skills/` 即可被 Cline 识别。
> **通用回退**：若以上工具均未检测到，尝试 `npx skills@latest add <source>` 安装，或由用户手动指定技能目录。

---

## 约束

- ❌ 不修改原始 `.harness/skills/` 内容（只复制，不移动）
- ❌ 不把 `install-skill` 自身当作要安装的技能
- ✅ 只安装到检测到的工具目录，不跨工具安装
- ✅ 若 `.harness/skills/` 不存在，提示先运行 `/apply-harness`
- ✅ 若某技能已存在，默认覆盖并提示