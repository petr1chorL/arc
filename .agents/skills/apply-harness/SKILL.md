---
name: apply-harness
description: 自动检测项目语言与框架（Java / Python / Go / Frontend，支持 Spring Boot / Quarkus / Django / Gin / React / Vue 等主流框架）并应用 Harness 开发规范体系
disable-model-invocation: true
---

# Apply Harness — 一键应用 Harness 开发规范体系

> 在任意项目根目录执行此命令，自动检测项目语言、框架与构建工具，生成 `.harness/` 目录（含 Owner Agent 定义、规则、技能、变更追踪、领域知识库）。

---

## 工作流程

### Step 1: 检测项目语言与框架

扫描项目根目录，按优先级检测。先识别语言，再从语言特征中识别具体框架和构建工具。

#### Java 检测

| 检测特征 | 框架 | 构建工具 | 版本 |
|---------|------|---------|------|
| `pom.xml` + `spring-boot-starter-parent` 或 `spring-boot-maven-plugin` | Spring Boot | Maven | 读取 Spring Boot 版本 |
| `pom.xml` + `quarkus-maven-plugin` 或 `quarkus` BOM | Quarkus | Maven | 读取 Quarkus 版本 |
| `pom.xml` + `micronaut-parent` 或 `micronaut-maven-plugin` | Micronaut | Maven | 读取 Micronaut 版本 |
| `pom.xml` + `vertx` 依赖 | Vert.x | Maven | 读取 Vert.x 版本 |
| `pom.xml` + `dropwizard` 核心依赖 | Dropwizard | Maven | 读取 Dropwizard 版本 |
| `pom.xml` + `spring-webmvc`（无 spring-boot-starter） | Spring MVC | Maven | 读取 Spring 版本 |
| `pom.xml` + `dubbo`（`dubbo-spring-boot-starter` 等） | Dubbo | Maven | 读取 Dubbo 版本 |
| `pom.xml` + `spring-cloud-alibaba` 依赖 | Spring Cloud Alibaba | Maven | 读取版本 |
| `pom.xml` + `spring-ai-alibaba` 依赖 | Spring AI Alibaba | Maven | 读取版本 |
| `pom.xml` + `spring-ai` 依赖（无 alibaba） | Spring AI | Maven | 读取 Spring AI 版本 |
| `pom.xml` + `agentscope` 依赖 | AgentScope Java | Maven | 读取版本 |
| `pom.xml` + `langchain4j` 依赖 | LangChain4j | Maven | 读取版本 |
| `pom.xml` + `semantic-kernel` 依赖 | Semantic Kernel | Maven | 读取版本 |
| `pom.xml` + `genkit` 依赖 | Genkit Java | Maven | 读取版本 |
| `pom.xml`（通用，未匹配以上） | 询问用户 | Maven | 读取 Java 版本 |
| `build.gradle(.kts)` + `spring-boot` plugin | Spring Boot | Gradle | 读取 Spring Boot 版本 |
| `build.gradle(.kts)` + `quarkus` plugin | Quarkus | Gradle | 读取 Quarkus 版本 |
| `build.gradle(.kts)` + `micronaut` plugin | Micronaut | Gradle | 读取 Micronaut 版本 |
| `build.gradle(.kts)`（通用，未匹配以上） | 询问用户 | Gradle | Gradle 版本 |

#### Python 检测

| 检测特征 | 框架 | 构建工具 | 版本 |
|---------|------|---------|------|
| `pyproject.toml` + `django` 依赖 | Django | pip/poetry/uv | 读取 Python 版本 |
| `pyproject.toml` + `fastapi` 依赖 | FastAPI | pip/poetry/uv | 读取 Python 版本 |
| `pyproject.toml` + `flask` 依赖 | Flask | pip/poetry/uv | 读取 Python 版本 |
| `pyproject.toml`（通用，未匹配以上） | 询问用户 | pip/poetry/uv | 读取 Python 版本 |
| `requirements.txt` + `django` | Django | pip | 推断 Python 3.x |
| `requirements.txt` + `fastapi` | FastAPI | pip | 推断 Python 3.x |
| `requirements.txt` + `flask` | Flask | pip | 推断 Python 3.x |
| `pyproject.toml` / `requirements.txt` + `tornado` | Tornado | pip/poetry/uv | 推断/读取 Python 版本 |
| `requirements.txt` + `tensorflow` | TensorFlow | pip | 推断 Python 3.x |
| `requirements.txt` + `torch` | PyTorch | pip | 推断 Python 3.x |
| `requirements.txt` + `keras` | Keras | pip | 推断 Python 3.x |
| `requirements.txt` + `scikit-learn` | scikit-learn | pip | 推断 Python 3.x |
| `requirements.txt` + `xgboost` | XGBoost | pip | 推断 Python 3.x |
| `requirements.txt` + `transformers` | Hugging Face Transformers | pip | 推断 Python 3.x |
| `requirements.txt` + `langchain` | LangChain | pip | 推断 Python 3.x |
| `requirements.txt` + `langgraph` | LangGraph | pip | 推断 Python 3.x |
| `requirements.txt` + `crewai` | CrewAI | pip | 推断 Python 3.x |
| `requirements.txt` + `pydantic-ai` | PydanticAI | pip | 推断 Python 3.x |
| `requirements.txt` + `smolagents` | SmolAgents | pip | 推断 Python 3.x |
| `requirements.txt` + `openai-agents` | OpenAI Agents SDK | pip | 推断 Python 3.x |
| `requirements.txt`（通用，未匹配） | 询问用户 | pip | 推断 Python 3.x |
| `setup.py` / `setup.cfg` | 询问用户 | pip | 推断 Python 3.x |
| `manage.py` + `django` 已安装 | Django | pip | 推断 Python 3.x |

#### Go 检测

| 检测特征 | 框架 | 构建工具 | 版本 |
|---------|------|---------|------|
| `go.mod` + `gin` import | Gin | go mod | 读取 Go 版本 |
| `go.mod` + `go-zero` 依赖 | go-zero | go mod | 读取 Go 版本 |
| `go.mod` + `echo` 依赖 | Echo | go mod | 读取 Go 版本 |
| `go.mod` + `fiber` 依赖 | Fiber | go mod | 读取 Go 版本 |
| `go.mod` + `chi` 依赖 | Chi | go mod | 读取 Go 版本 |
| `go.mod` + `beego` 依赖 | Beego | go mod | 读取 Go 版本 |
| `go.mod` + `go-kit` 依赖 | Go-Kit | go mod | 读取 Go 版本 |
| `go.mod` + `kratos` 依赖 | Go-Kratos | go mod | 读取 Go 版本 |
| `go.mod` + `gorilla/mux` 依赖 | Gorilla Mux | go mod | 读取 Go 版本 |
| `go.mod` + `kitex` 依赖 | Kitex | go mod | 读取 Go 版本 |
| `go.mod` + `hertz` 依赖 | Hertz | go mod | 读取 Go 版本 |
| `go.mod` + `iris` 依赖 | Iris | go mod | 读取 Go 版本 |
| `go.mod` + `macaron` 依赖 | Macaron | go mod | 读取 Go 版本 |
| `go.mod` + `tango` 依赖 | Tango | go mod | 读取 Go 版本 |
| `go.mod` + `goframe` 依赖 | goframe | go mod | 读取 Go 版本 |
| `go.mod` + `langchaingo` 依赖 | LangChainGo | go mod | 读取 Go 版本 |
| `go.mod` + `adk-go` 依赖 | Google ADK-Go | go mod | 读取 Go 版本 |
| `go.mod` + `cloudwego/eino` 依赖 | eino（cloudwego） | go mod | 读取 Go 版本 |
| `go.mod` + `trpc-agent` 依赖 | tRPC-Agent-Go | go mod | 读取 Go 版本 |
| `go.mod` + `genkit` 依赖 | Firebase Genkit | go mod | 读取 Go 版本 |
| `go.mod` + `anyi` 依赖 | Anyi | go mod | 读取 Go 版本 |
| `go.mod`（通用，未匹配以上） | 询问用户 | go mod | 读取 Go 版本 |

#### Frontend 检测

| 检测特征 | 框架 | 构建工具 | 版本 |
|---------|------|---------|------|
| `package.json` + `vue` + `vite` 或 `vite.config.ts` | Vue 3 + Vite | npm/pnpm/yarn | 读取 Vue 版本 |
| `package.json` + `vue` + `vue.config.js` | Vue 3 + Vue CLI | npm/pnpm/yarn | 读取 Vue 版本 |
| `package.json` + `nuxt` 或 `nuxt.config.ts` | Nuxt | npm/pnpm/yarn | 读取 Nuxt 版本 |
| `package.json` + `react` + `next` 或 `next.config` | Next.js | npm/pnpm/yarn | 读取 Next.js 版本 |
| `package.json` + `react` + `vite` | React + Vite | npm/pnpm/yarn | 读取 React 版本 |
| `package.json` + `react` + `react-scripts`（CRA） | React + CRA | npm/pnpm/yarn | 读取 React 版本 |
| `package.json` + `@angular/core` 或 `angular.json` | Angular | npm/pnpm/yarn | 读取 Angular 版本 |
| `package.json` + `svelte` + `vite` | Svelte + Vite | npm/pnpm/yarn | 读取 Svelte 版本 |
| `package.json`（含前端框架，未匹配以上） | 询问用户 | npm/pnpm/yarn | 读取 Node 版本 |
| `package.json`（仅有 `vite`）+ `index.html` + 无前端框架 | 纯 Vite | npm/pnpm/yarn | 推断为纯 Vite 项目 |

#### 多语言项目处理

同时有前端+后端（如 `package.json` + `pom.xml` / `go.mod` / `pyproject.toml`）：询问用户选择当前焦点语言。

#### 无法识别

未匹配任何检测特征：询问用户手动指定语言、框架和构建工具。

---

### Step 2: 读取项目名称

| 语言 | 读取方式 |
|------|---------|
| Java (Maven) | `pom.xml` → `<artifactId>` 或 `<name>` |
| Java (Gradle) | `settings.gradle(.kts)` → `rootProject.name` 或目录名 |
| Go | `go.mod` → `module` 后的模块名 |
| Python | `pyproject.toml` → `[project] name` 或目录名 |
| Frontend | `package.json` → `name` 字段或目录名 |

### Step 3: 渲染 owner.md（灵魂生成）

将 `harness-core/templates/agents/owner.md` 参数化渲染。根据 Step 1 检测到的（语言、框架、构建工具）三元组，从下文「参数表」中选择对应的框架参数块。对于未匹配的框架（用户手动指定的），询问用户确认各参数值。

| 参数 | 说明 |
|------|------|
| `{{PROJECT_NAME}}` | 项目名称（从 Step 2 读取） |
| `{{LANGUAGE}}` | `Java` / `Python` / `Go` / `Frontend` |
| `{{LANGUAGE_DESC}}` | 语言技术栈描述（见下文参数表，按检测到的框架选择） |
| `{{LANGUAGE_RUNTIME}}` | 运行时版本 |
| `{{FRAMEWORK_VER}}` | 框架版本（从检测到的框架参数块读取） |
| `{{BUILD_TOOL}}` | 构建工具（从检测到的框架参数块读取） |
| `{{TEST_FRAMEWORK}}` | 测试框架（从检测到的框架参数块读取） |
| `{{COV_TOOL}}` | 覆盖率工具 |
| `{{LINT_TOOL}}` | 代码规范检查工具 |
| `{{ARCH_TEST_TOOL}}` | 架构约束守护工具 |
| `{{DB_ACCESS}}` | 数据库访问方式 |

### Step 4: 复制规则文件

1. 从 `harness-core/rules/` 复制通用规则到 `.harness/rules/`
2. 从 `harness-{lang}/rules/` 复制语言特有规则到 `.harness/rules/`（同名覆盖）

```
.harness/rules/
├── SDD-TDD模式.md       ← 来自 harness-core（跨语言通用）
├── 开发流程规范.md       ← 来自 harness-core（跨语言通用）
├── 运行时可靠性.md       ← 来自 harness-core（后端）/ 来自 harness-front（前端特有）
├── 编码规范.md           ← 来自 harness-{lang}（语言特有）
└── 工程结构.md           ← 来自 harness-{lang}（语言特有）
```

> **注意**: 对于后端项目（Java/Python/Go），`运行时可靠性.md` 来自通用版；对于前端项目，`运行时可靠性.md` 来自 `harness-front`（前端特有版本，会覆盖通用版）。

### Step 5: 渲染技能模板 + 复制技能文件

1. **渲染模板化技能**：从 `harness-core/skills/` 读取模板 SKILL.md，替换其中的 `{{PLACEHOLDER}}` 为语言参数表中对应框架参数块的值，写入 `.harness/skills/{lang}/`
2. **复制语言特有技能**：从 `harness-{lang}/skills/` 复制全部技能目录到 `.harness/skills/{lang}/`，并同时将该语言对应框架参数块的值替换其中的 `{{PLACEHOLDER}}`（同名覆盖渲染文件，语言特有内容优先）
3. **复制跨语言通用技能**：从 `harness-core/skills/` 复制 `domain-modeling`、`research`、`resolving-merge-conflicts` 到 `.harness/skills/common/`（纯通用，无需渲染）

**模板化技能清单**（以下技能的核心逻辑来自 `harness-core/skills/` 模板，语言包提供覆写）：

| 技能 | 模板位置 | 语言包覆写 |
|------|---------|-----------|
| `harness-me` | `harness-core/skills/harness-me/` | `harness-{lang}/skills/harness-me/` |
| `handoff` | `harness-core/skills/handoff/` | `harness-{lang}/skills/handoff/` |
| `diagnosing-bugs` | `harness-core/skills/diagnosing-bugs/` | `harness-{lang}/skills/diagnosing-bugs/` |
| `coding-skill` | `harness-core/skills/coding-skill/` | `harness-{lang}/skills/coding-skill/` |
| `unit-test-write` | `harness-core/skills/unit-test-write/` | `harness-{lang}/skills/unit-test-write/` |

**技能参数说明**——渲染时替换模板中的 `{{PLACEHOLDER}}`：

| 参数 | 说明 |
|------|------|
| `{{LANG_TAG}}` | 技能名称后缀，如 `-python`、`-java`、`-golang`、`-front` |
| `{{HARNESS_ME_NAME}}` | harness-me 技能名（`harness-me`/`harness-me-python`/`harness-me-golang`/`harness-me-front`） |
| `{{HARNESSING_CMD}}` | harnessing 命令，如 `/harnessing`、`/harnessing-python` |
| `{{BUILD_CMD}}` | 编译命令，如 `mvn compile`、`go build ./...` |
| `{{TEST_CMD}}` | 测试命令 |
| `{{LINT_CMD}}` | 代码规范检查命令 |
| `{{DEV_CMD}}` | 开发服务器启动命令 |
| `{{DOCSTYLE}}` | 文档注释风格，如 `Javadoc`、`docstring`、`JSDoc` |
| `{{FILE_LIMIT}}` | 单文件行数上限 |
| `{{FRAMEWORK_DESC}}` | 语言技术栈描述 |
| `{{ARCH_LAYER}}` | 架构依赖方向描述 |
| `{{TEST_NAMING}}` | 测试命名规范 |
| `{{MOCK_LIB}}` | Mock 库 |
| `{{COV_CMD}}` | 覆盖率检查命令 |
| `{{DEBUG_TOOL}}` | 调试工具 |
| `{{ARCH_REVIEW_CMD}}` | 架构审查命令，如 `/arch-review`、`/arch-review-python` |

```
.harness/skills/
├── {lang}/                # 语言特有技能
│   ├── coding-skill/      # 编码实现
│   ├── unit-test-write/   # 单测编写
│   ├── expert-reviewer/   # 专家评审
│   ├── unit-test-ci/      # CI 门禁
│   ├── deploy-verify/     # 部署验证
│   ├── harness-me/        # 需求打磨（可选辅助）
│   ├── harnessing/        # 需求拷问引擎（可选辅助）
│   ├── diagnosing-bugs/   # Bug 诊断（可选辅助）
│   ├── handoff/           # 上下文交接（可选辅助）
│   └── arch-review/       # 架构体检（可选辅助）
└── common/                # 跨语言通用技能
    ├── domain-modeling/           # 领域语言维护（术语敲定当场写 CONTEXT.md / ADR）
    ├── research/                  # 外部事实查证（一手来源，结果落 wiki）
    └── resolving-merge-conflicts/ # 解决 git merge/rebase 冲突
```

### Step 5.5: 注册技能到当前 AI 工具

> 将 `.harness/skills/` 下的技能注册到当前 AI 工具（reasonix / claude-code / codex）可识别的技能目录，使 `/harnessing`、`/harness-me` 等斜杠命令立即可用。

**本步骤自动尝试注册**。若当前 AI 工具的技能目录可被检测到，技能将自动注册到该目录，Step 8 的输出卡片中 `/install-skill` 可跳过。若检测失败（无法确定工具类型），则跳过注册，提示用户在 Step 8 手动执行 `/install-skill`。

调用 `install-skill` 技能（或直接执行其逻辑）：

1. **检测当前工具**：按优先级检测 `.reasonix/` → `.claude/` → `.cline/` → `.cursor/` → `.codex/` → `.qoder/` → `.vscode/` → `.windsurf/` → `.continue/` → `.github/` → `.opencode/` → `.trae/` → `.codebuddy/` → `.lingma/` → `.codegeex/` → `.tabnine/` → `.cody/` 目录（或对应环境变量），确定技能安装目录
2. **定位技能来源**：扫描 `.harness/skills/` 下所有含 `SKILL.md` 的技能目录
3. **复制安装**：将每个技能目录完整复制到目标工具目录（保持 frontmatter `name` 不变）
4. **输出摘要**：列出已安装的技能及对应斜杠命令

> 若自动注册成功，技能命令立即可用；若自动注册失败，继续执行 Step 6-8，在 Step 8 的输出卡片中用户可通过 `/install-skill` 手动注册。

### Step 6: 初始化变更追踪

从 `harness-core/templates/changes/` 复制到 `.harness/changes/`：

```
.harness/changes/
└── _TEMPLATE/
    ├── change.md      ← 变更卡模板
    ├── review.md      ← 评审报告模板
    └── verify.md      ← 部署验证报告模板
```

### Step 7: 初始化领域知识库

从 `harness-core/templates/wiki/` 复制到 `.harness/wiki/`：

```
.harness/wiki/
├── 业务模型.md     ← 业务结构与关系模板，待补充
├── 接口协议.md     ← 接口契约模板，待补充
├── 数据模型.md     ← 数据模型模板，待补充
├── 架构决策.md     ← ADR 记录模板，待补充
└── ADR-FORMAT.md   ← ADR 编写规范（什么值得写 / 怎么写）
```

### Step 7.1: 初始化共享语言上下文

从 `harness-core/templates/CONTEXT.md` 复制到 `.harness/CONTEXT.md`，从 `harness-core/templates/CONTEXT-FORMAT.md` 复制到 `.harness/CONTEXT-FORMAT.md`：

```
.harness/
├── CONTEXT.md          ← 领域语言术语表（活词典）
└── CONTEXT-FORMAT.md   ← CONTEXT.md 编写规范
```

> **CONTEXT.md 的作用**：AI 与人类之间的共享语言机制，记录项目特有的领域术语、缩写、决策、约定。由 `domain-modeling` 技能在对话中主动维护——术语敲定后**当场写**，不批量累积。每次对话结束时，AI 应检查是否有新术语/决策需要补充。
> **CONTEXT-FORMAT.md 的作用**：定义 CONTEXT.md 的编写规范（只存术语、要有主见、定义克制、只收项目特有概念）。

### Step 8: 输出项目摘要卡片

```
╔══════════════════════════════════════════╗
║   ✅ Harness 规范已应用到 <项目名>       ║
╠══════════════════════════════════════════╣
║  语言:   Java / Python / Go / Frontend   ║
║  框架:   Spring Boot 3.x / Django 5.x    ║
║  规则:   5 个已就绪（3 通用 + 2 语言特有）   ║
║  技能:   12 个已就绪（9 语言特有 + 3 通用）║
║  Owner:  已就绪                          ║
╠══════════════════════════════════════════╣
║  下一步: 注册技能到当前工具              ║
║  /install-skill                          ║
║  然后创建你的第一个变更:                  ║
║  /harnessing 一句话描述需求            ║
╚══════════════════════════════════════════╝
```

## 参数表

> 按 Step 1 检测到的（语言、框架、构建工具）三元组，选择对应的框架参数块。未在此列出的框架（用户手动指定）询问用户确认参数。

### Java — Spring Boot + Maven（默认）

| 参数 | 值 |
|------|-----|
| `{{LANGUAGE}}` | `Java` |
| `{{LANGUAGE_DESC}}` | Java、Spring Boot、多模块 Maven 架构 |
| `{{LANGUAGE_RUNTIME}}` | JDK 21 LTS |
| `{{FRAMEWORK_VER}}` | Spring Boot 3.x+ |
| `{{BUILD_TOOL}}` | Maven 3.9+ |
| `{{TEST_FRAMEWORK}}` | JUnit 5 + Mockito + AssertJ |
| `{{COV_TOOL}}` | JaCoCo (核心逻辑 ≥80%) |
| `{{LINT_TOOL}}` | Checkstyle + PMD + SpotBugs |
| `{{ARCH_TEST_TOOL}}` | ArchUnit |
| `{{DB_ACCESS}}` | MyBatis-Plus / JPA + Flyway |
| `{{LANG_TAG}}` | `-java` |
| `{{HARNESS_ME_NAME}}` | `harness-me` |
| `{{HARNESSING_CMD}}` | `/harnessing` |
| `{{BUILD_CMD}}` | `mvn compile` |
| `{{TEST_CMD}}` | `mvn test` |
| `{{LINT_CMD}}` | `mvn checkstyle:check` |
| `{{DEV_CMD}}` | `mvn spring-boot:run` |
| `{{DOCSTYLE}}` | `Javadoc` |
| `{{FILE_LIMIT}}` | `500` |
| `{{ARCH_LAYER}}` | 模块间仅通过接口通信，依赖方向 `common ← service ← server` |
| `{{TEST_NAMING}}` | `method_should_x_when_y` |
| `{{MOCK_LIB}}` | `Mockito` |
| `{{COV_CMD}}` | `mvn jacoco:report` |
| `{{DEBUG_TOOL}}` | 调试器 / `jdb` |
| `{{ARCH_REVIEW_CMD}}` | `/arch-review` |
| `{{ARCH_TEST_CMD}}` | 架构约束测试命令 |
| `{{SECURITY_CMD}}` | 安全扫描命令 |
| `{{INTEGRATION_CMD}}` | 集成测试命令 |
| `{{RUN_CMD}}` | 启动服务命令 |
| `{{HEALTH_CHECK_CMD}}` | 健康检查命令 |
| `{{HEALTH_ENDPOINT}}` | 健康检查端点 |
| `{{METRICS_ENDPOINT}}` | 指标端点 |
| `{{VET_CMD}}` | 静态分析命令（实际合并到 LINT_CMD） |
| `{{DEP_CMD}}` | 依赖管理命令：`mvn dependency:tree` |
| `{{ORM_TOOL}}` | ORM 框架：MyBatis-Plus / JPA |
| `{{TYPE_CHECK_TOOL}}` | 类型检查工具：javac（编译时检查） |
| `{{TYPE_CHECK_CMD}}` | 类型检查命令：`{{BUILD_CMD}}` |
| `{{ASSERT_LIB}}` | 断言库：AssertJ |
| `{{RACE_DETECT_ARG}}` | 竞态检测参数：空 |

### Java — Spring Boot + Gradle

仅 `{{BUILD_TOOL}}`、`{{BUILD_CMD}}`、`{{TEST_CMD}}`、`{{LINT_CMD}}`、`{{DEV_CMD}}`、`{{COV_CMD}}` 与 Maven 版不同：

| 参数 | 值 |
|------|-----|
| `{{LANGUAGE_DESC}}` | Java、Spring Boot、多模块 Gradle 架构 |
| `{{BUILD_TOOL}}` | Gradle 8.x（Gradle Wrapper） |
| `{{BUILD_CMD}}` | `./gradlew build` |
| `{{TEST_CMD}}` | `./gradlew test` |
| `{{LINT_CMD}}` | `./gradlew checkstyleMain` |
| `{{DEV_CMD}}` | `./gradlew bootRun` |
| `{{COV_CMD}}` | `./gradlew jacocoTestReport` |

### Java — Quarkus + Maven

| 参数 | 值 |
|------|-----|
| `{{LANGUAGE}}` | `Java` |
| `{{LANGUAGE_DESC}}` | Java、Quarkus、GraalVM 原生可执行 |
| `{{LANGUAGE_RUNTIME}}` | JDK 21 LTS |
| `{{FRAMEWORK_VER}}` | Quarkus 3.x |
| `{{BUILD_TOOL}}` | Maven 3.9+ |
| `{{TEST_FRAMEWORK}}` | JUnit 5 + Mockito + AssertJ |
| `{{COV_TOOL}}` | JaCoCo (核心逻辑 ≥80%) |
| `{{LINT_TOOL}}` | Checkstyle + PMD + SpotBugs |
| `{{ARCH_TEST_TOOL}}` | ArchUnit |
| `{{DB_ACCESS}}` | Hibernate Panache / JPA + Flyway |
| `{{LANG_TAG}}` | `-java` |
| `{{HARNESS_ME_NAME}}` | `harness-me` |
| `{{HARNESSING_CMD}}` | `/harnessing` |
| `{{BUILD_CMD}}` | `mvn compile` |
| `{{TEST_CMD}}` | `mvn test` |
| `{{LINT_CMD}}` | `mvn checkstyle:check` |
| `{{DEV_CMD}}` | `mvn quarkus:dev` |
| `{{DOCSTYLE}}` | `Javadoc` |
| `{{FILE_LIMIT}}` | `500` |
| `{{ARCH_LAYER}}` | 分层 `entity → repository → service → resource`，依赖单向 |
| `{{TEST_NAMING}}` | `method_should_x_when_y` |
| `{{MOCK_LIB}}` | `Mockito` |
| `{{COV_CMD}}` | `mvn jacoco:report` |
| `{{DEBUG_TOOL}}` | 调试器 / `jdb` |
| `{{ARCH_REVIEW_CMD}}` | `/arch-review` |

### Java — Quarkus + Gradle

| 参数 | 值 |
|------|-----|
| `{{LANGUAGE_DESC}}` | Java、Quarkus、GraalVM 原生可执行 |
| `{{BUILD_TOOL}}` | Gradle 8.x（Gradle Wrapper） |
| `{{BUILD_CMD}}` | `./gradlew build` |
| `{{TEST_CMD}}` | `./gradlew test` |
| `{{LINT_CMD}}` | `./gradlew checkstyleMain` |
| `{{DEV_CMD}}` | `./gradlew quarkusDev` |
| `{{COV_CMD}}` | `./gradlew jacocoTestReport` |

### Java — Micronaut + Maven

| 参数 | 值 |
|------|-----|
| `{{LANGUAGE}}` | `Java` |
| `{{LANGUAGE_DESC}}` | Java、Micronaut、低内存云原生框架 |
| `{{LANGUAGE_RUNTIME}}` | JDK 21 LTS |
| `{{FRAMEWORK_VER}}` | Micronaut 4.x |
| `{{BUILD_TOOL}}` | Maven 3.9+ |
| `{{TEST_FRAMEWORK}}` | JUnit 5 + Mockito |
| `{{COV_TOOL}}` | JaCoCo (核心逻辑 ≥80%) |
| `{{LINT_TOOL}}` | Checkstyle + PMD + SpotBugs |
| `{{ARCH_TEST_TOOL}}` | ArchUnit |
| `{{DB_ACCESS}}` | Micronaut Data + Flyway |
| `{{LANG_TAG}}` | `-java` |
| `{{HARNESS_ME_NAME}}` | `harness-me` |
| `{{HARNESSING_CMD}}` | `/harnessing` |
| `{{BUILD_CMD}}` | `mvn compile` |
| `{{TEST_CMD}}` | `mvn test` |
| `{{LINT_CMD}}` | `mvn checkstyle:check` |
| `{{DEV_CMD}}` | `mvn mn:run` |
| `{{DOCSTYLE}}` | `Javadoc` |
| `{{FILE_LIMIT}}` | `500` |
| `{{ARCH_LAYER}}` | 分层 `domain → service → controller`，依赖单向 |
| `{{TEST_NAMING}}` | `method_should_x_when_y` |
| `{{MOCK_LIB}}` | `Mockito` |
| `{{COV_CMD}}` | `mvn jacoco:report` |
| `{{DEBUG_TOOL}}` | 调试器 / `jdb` |
| `{{ARCH_REVIEW_CMD}}` | `/arch-review` |

### Java — Vert.x + Maven

| 参数 | 值 |
|------|-----|
| `{{LANGUAGE}}` | `Java` |
| `{{LANGUAGE_DESC}}` | Java、Vert.x、响应式事件驱动框架 |
| `{{LANGUAGE_RUNTIME}}` | JDK 21 LTS |
| `{{FRAMEWORK_VER}}` | Vert.x 4.x |
| `{{BUILD_TOOL}}` | Maven 3.9+ |
| `{{TEST_FRAMEWORK}}` | JUnit 5 + Mockito + Vert.x Test |
| `{{COV_TOOL}}` | JaCoCo (核心逻辑 ≥80%) |
| `{{LINT_TOOL}}` | Checkstyle + PMD + SpotBugs |
| `{{ARCH_TEST_TOOL}}` | ArchUnit |
| `{{DB_ACCESS}}` | Vert.x JDBC/MySQL 客户端 |
| `{{LANG_TAG}}` | `-java` |
| `{{HARNESS_ME_NAME}}` | `harness-me` |
| `{{HARNESSING_CMD}}` | `/harnessing` |
| `{{BUILD_CMD}}` | `mvn compile` |
| `{{TEST_CMD}}` | `mvn test` |
| `{{LINT_CMD}}` | `mvn checkstyle:check` |
| `{{DEV_CMD}}` | `mvn vertx:run` |
| `{{DOCSTYLE}}` | `Javadoc` |
| `{{FILE_LIMIT}}` | `500` |
| `{{ARCH_LAYER}}` | Verticle 间通过事件总线通信，禁止直接耦合 |
| `{{TEST_NAMING}}` | `method_should_x_when_y` |
| `{{MOCK_LIB}}` | `Mockito` |
| `{{COV_CMD}}` | `mvn jacoco:report` |
| `{{DEBUG_TOOL}}` | 调试器 / `jdb` |
| `{{ARCH_REVIEW_CMD}}` | `/arch-review` |

### Java — Dropwizard + Maven

| 参数 | 值 |
|------|-----|
| `{{LANGUAGE}}` | `Java` |
| `{{LANGUAGE_DESC}}` | Java、Dropwizard、轻量 REST 服务 |
| `{{LANGUAGE_RUNTIME}}` | JDK 21 LTS |
| `{{FRAMEWORK_VER}}` | Dropwizard 4.x |
| `{{BUILD_TOOL}}` | Maven 3.9+ |
| `{{TEST_FRAMEWORK}}` | JUnit 5 + Mockito + AssertJ |
| `{{COV_TOOL}}` | JaCoCo (核心逻辑 ≥80%) |
| `{{LINT_TOOL}}` | Checkstyle + PMD + SpotBugs |
| `{{ARCH_TEST_TOOL}}` | ArchUnit |
| `{{DB_ACCESS}}` | JDBI / Hibernate + Flyway |
| `{{LANG_TAG}}` | `-java` |
| `{{HARNESS_ME_NAME}}` | `harness-me` |
| `{{HARNESSING_CMD}}` | `/harnessing` |
| `{{BUILD_CMD}}` | `mvn compile` |
| `{{TEST_CMD}}` | `mvn test` |
| `{{LINT_CMD}}` | `mvn checkstyle:check` |
| `{{DEV_CMD}}` | `java -jar target/*.jar server config.yml` |
| `{{DOCSTYLE}}` | `Javadoc` |
| `{{FILE_LIMIT}}` | `500` |
| `{{ARCH_LAYER}}` | 分层 `domain → service → resource`，依赖单向 |
| `{{TEST_NAMING}}` | `method_should_x_when_y` |
| `{{MOCK_LIB}}` | `Mockito` |
| `{{COV_CMD}}` | `mvn jacoco:report` |
| `{{DEBUG_TOOL}}` | 调试器 / `jdb` |
| `{{ARCH_REVIEW_CMD}}` | `/arch-review` |

### Java — Spring MVC + Maven（经典 Servlet 架构）

| 参数 | 值 |
|------|-----|
| `{{LANGUAGE}}` | `Java` |
| `{{LANGUAGE_DESC}}` | Java、Spring MVC、经典 Servlet 分层架构 |
| `{{LANGUAGE_RUNTIME}}` | JDK 21 LTS |
| `{{FRAMEWORK_VER}}` | Spring 6.x Web MVC |
| `{{BUILD_TOOL}}` | Maven 3.9+ |
| `{{TEST_FRAMEWORK}}` | JUnit 5 + Mockito + AssertJ |
| `{{COV_TOOL}}` | JaCoCo (核心逻辑 ≥80%) |
| `{{LINT_TOOL}}` | Checkstyle + PMD + SpotBugs |
| `{{ARCH_TEST_TOOL}}` | ArchUnit |
| `{{DB_ACCESS}}` | MyBatis-Plus / JPA + Flyway |
| `{{LANG_TAG}}` | `-java` |
| `{{HARNESS_ME_NAME}}` | `harness-me` |
| `{{HARNESSING_CMD}}` | `/harnessing` |
| `{{BUILD_CMD}}` | `mvn compile` |
| `{{TEST_CMD}}` | `mvn test` |
| `{{LINT_CMD}}` | `mvn checkstyle:check` |
| `{{DEV_CMD}}` | `mvn tomcat7:run` / 部署到外部 Servlet 容器 |
| `{{DOCSTYLE}}` | `Javadoc` |
| `{{FILE_LIMIT}}` | `500` |
| `{{ARCH_LAYER}}` | 分层 `controller → service → mapper/repository`，依赖单向 |
| `{{TEST_NAMING}}` | `method_should_x_when_y` |
| `{{MOCK_LIB}}` | `Mockito` |
| `{{COV_CMD}}` | `mvn jacoco:report` |
| `{{DEBUG_TOOL}}` | 调试器 / `jdb` |
| `{{ARCH_REVIEW_CMD}}` | `/arch-review` |

---

### Python — FastAPI

| 参数 | 值 |
|------|-----|
| `{{LANGUAGE}}` | `Python` |
| `{{LANGUAGE_DESC}}` | Python、FastAPI、异步 API 服务 |
| `{{LANGUAGE_RUNTIME}}` | Python 3.11+ |
| `{{FRAMEWORK_VER}}` | FastAPI 0.110+ |
| `{{BUILD_TOOL}}` | pip + virtualenv / poetry / uv |
| `{{TEST_FRAMEWORK}}` | pytest + pytest-mock |
| `{{COV_TOOL}}` | pytest-cov (核心逻辑 ≥80%) |
| `{{LINT_TOOL}}` | flake8 + mypy + black + isort |
| `{{ARCH_TEST_TOOL}}` | 自定义 import-lint 检查 |
| `{{DB_ACCESS}}` | SQLAlchemy + Alembic |
| `{{LANG_TAG}}` | `-python` |
| `{{HARNESS_ME_NAME}}` | `harness-me-python` |
| `{{HARNESSING_CMD}}` | `/harnessing-python` |
| `{{BUILD_CMD}}` | `python -m compileall .` |
| `{{TEST_CMD}}` | `python -m pytest` |
| `{{LINT_CMD}}` | `flake8 .` |
| `{{DEV_CMD}}` | `uvicorn main:app --reload` |
| `{{DOCSTYLE}}` | `docstring` |
| `{{FILE_LIMIT}}` | `800` |
| `{{ARCH_LAYER}}` | 依赖方向 `router → handler → service → model` |
| `{{TEST_NAMING}}` | `test_x_when_y` |
| `{{MOCK_LIB}}` | `pytest-mock` |
| `{{COV_CMD}}` | `pytest --cov` |
| `{{DEBUG_TOOL}}` | `pdb` / `breakpoint()` / `ipdb` |
| `{{ARCH_REVIEW_CMD}}` | `/arch-review-python` |
| `{{ARCH_TEST_CMD}}` | 架构约束测试命令 |
| `{{SECURITY_CMD}}` | 安全扫描命令 |
| `{{INTEGRATION_CMD}}` | 集成测试命令 |
| `{{RUN_CMD}}` | 启动服务命令 |
| `{{HEALTH_CHECK_CMD}}` | 健康检查命令 |
| `{{HEALTH_ENDPOINT}}` | 健康检查端点 |
| `{{METRICS_ENDPOINT}}` | 指标端点 |
| `{{VET_CMD}}` | 静态分析命令：`mypy` |
| `{{DEP_CMD}}` | 依赖管理命令：`pip install` / `poetry add` |
| `{{ORM_TOOL}}` | ORM 框架：SQLAlchemy |
| `{{TYPE_CHECK_TOOL}}` | 类型检查工具：mypy |
| `{{TYPE_CHECK_CMD}}` | 类型检查命令：`mypy` |
| `{{FORMAT_TOOL}}` | 格式化工具：black |
| `{{FORMAT_CHECK_CMD}}` | 格式检查命令：`black --check .` |
| `{{METRICS_CHECK_CMD}}` | 指标检查命令：`curl {{METRICS_ENDPOINT}}` |
| `{{ASSERT_LIB}}` | 断言库：`assert` |
| `{{RACE_DETECT_ARG}}` | 竞态检测参数：空 |

### Python — Flask

| 参数 | 值 |
|------|-----|
| `{{LANGUAGE_DESC}}` | Python、Flask、轻量模板化 Web 服务 |
| `{{FRAMEWORK_VER}}` | Flask 3.x |
| `{{LANGUAGE_RUNTIME}}` | Python 3.11+ |
| `{{BUILD_TOOL}}` | pip + virtualenv / poetry / uv |
| `{{TEST_FRAMEWORK}}` | pytest + pytest-mock |
| `{{COV_TOOL}}` | pytest-cov (核心逻辑 ≥80%) |
| `{{LINT_TOOL}}` | flake8 + mypy + black + isort |
| `{{ARCH_TEST_TOOL}}` | 自定义 import-lint 检查 |
| `{{DB_ACCESS}}` | SQLAlchemy + Flask-Migrate（Alembic） |
| `{{LANG_TAG}}` | `-python` |
| `{{HARNESS_ME_NAME}}` | `harness-me-python` |
| `{{HARNESSING_CMD}}` | `/harnessing-python` |
| `{{BUILD_CMD}}` | `python -m compileall .` |
| `{{TEST_CMD}}` | `python -m pytest` |
| `{{LINT_CMD}}` | `flake8 .` |
| `{{DEV_CMD}}` | `flask --app <app> run --debug` |
| `{{DOCSTYLE}}` | `docstring` |
| `{{FILE_LIMIT}}` | `800` |
| `{{ARCH_LAYER}}` | 依赖方向 `blueprint/router → handler → service → model` |
| `{{TEST_NAMING}}` | `test_x_when_y` |
| `{{MOCK_LIB}}` | `pytest-mock` |
| `{{COV_CMD}}` | `pytest --cov` |
| `{{DEBUG_TOOL}}` | `pdb` / `breakpoint()` / `ipdb` |
| `{{ARCH_REVIEW_CMD}}` | `/arch-review-python` |

### Python — Django

| 参数 | 值 |
|------|-----|
| `{{LANGUAGE}}` | `Python` |
| `{{LANGUAGE_DESC}}` | Python、Django、全栈 MTV 框架（自带 ORM/Admin/迁移） |
| `{{LANGUAGE_RUNTIME}}` | Python 3.11+ |
| `{{FRAMEWORK_VER}}` | Django 5.x |
| `{{BUILD_TOOL}}` | pip + virtualenv / poetry / uv |
| `{{TEST_FRAMEWORK}}` | Django TestCase + pytest-django |
| `{{COV_TOOL}}` | pytest-cov (核心逻辑 ≥80%) |
| `{{LINT_TOOL}}` | flake8 + mypy + black + isort |
| `{{ARCH_TEST_TOOL}}` | 自定义 import-lint 检查 |
| `{{DB_ACCESS}}` | Django ORM + 内置迁移（makemigrations） |
| `{{LANG_TAG}}` | `-python` |
| `{{HARNESS_ME_NAME}}` | `harness-me-python` |
| `{{HARNESSING_CMD}}` | `/harnessing-python` |
| `{{BUILD_CMD}}` | `python -m compileall .` |
| `{{TEST_CMD}}` | `python manage.py test` |
| `{{LINT_CMD}}` | `flake8 .` |
| `{{DEV_CMD}}` | `python manage.py runserver` |
| `{{DOCSTYLE}}` | `docstring` |
| `{{FILE_LIMIT}}` | `800` |
| `{{ARCH_LAYER}}` | MTV 分层：依赖方向 `views → services/models → ORM` |
| `{{TEST_NAMING}}` | `test_x_when_y` |
| `{{MOCK_LIB}}` | `pytest-mock` / `unittest.mock` |
| `{{COV_CMD}}` | `pytest --cov` |
| `{{DEBUG_TOOL}}` | `pdb` / `django-debug-toolbar` |
| `{{ARCH_REVIEW_CMD}}` | `/arch-review-python` |

---

### Go — Gin

| 参数 | 值 |
|------|-----|
| `{{LANGUAGE}}` | `Go` |
| `{{LANGUAGE_DESC}}` | Go、Gin、高性能 HTTP 框架 |
| `{{LANGUAGE_RUNTIME}}` | Go 1.22+ |
| `{{FRAMEWORK_VER}}` | Gin 1.10+ |
| `{{BUILD_TOOL}}` | go mod |
| `{{TEST_FRAMEWORK}}` | go test + testify |
| `{{COV_TOOL}}` | go test -cover (核心逻辑 ≥80%) |
| `{{LINT_TOOL}}` | golangci-lint (go vet + staticcheck) |
| `{{ARCH_TEST_TOOL}}` | goimports + 自定义架构检查 |
| `{{DB_ACCESS}}` | GORM / sqlx + golang-migrate |
| `{{LANG_TAG}}` | `-golang` |
| `{{HARNESS_ME_NAME}}` | `harness-me-golang` |
| `{{HARNESSING_CMD}}` | `/harnessing-golang` |
| `{{BUILD_CMD}}` | `go build ./...` |
| `{{TEST_CMD}}` | `go test ./...` |
| `{{LINT_CMD}}` | `golangci-lint run` |
| `{{DEV_CMD}}` | `go run ./cmd/server` |
| `{{DOCSTYLE}}` | Go 注释 |
| `{{FILE_LIMIT}}` | `800` |
| `{{ARCH_LAYER}}` | 分层 `handler → service → repository`，依赖单向 |
| `{{TEST_NAMING}}` | `TestX_WhenY` |
| `{{MOCK_LIB}}` | `gomock` / `testify` |
| `{{COV_CMD}}` | `go test -cover` |
| `{{DEBUG_TOOL}}` | `delve` |
| `{{ARCH_REVIEW_CMD}}` | `/arch-review` |
| `{{ARCH_TEST_CMD}}` | 架构约束测试命令 |
| `{{SECURITY_CMD}}` | 安全扫描命令 |
| `{{INTEGRATION_CMD}}` | 集成测试命令 |
| `{{RUN_CMD}}` | 启动服务命令 |
| `{{HEALTH_CHECK_CMD}}` | 健康检查命令 |
| `{{HEALTH_ENDPOINT}}` | 健康检查端点 |
| `{{METRICS_ENDPOINT}}` | 指标端点 |
| `{{VET_CMD}}` | 静态分析命令：`go vet ./...` |
| `{{DEP_CMD}}` | 依赖管理命令：`go mod tidy` |
| `{{ORM_TOOL}}` | ORM 框架：GORM / sqlx |
| `{{TYPE_CHECK_TOOL}}` | 类型检查工具：go vet |
| `{{TYPE_CHECK_CMD}}` | 类型检查命令：`go vet ./...` |
| `{{ASSERT_LIB}}` | 断言库：testify |
| `{{RACE_DETECT_ARG}}` | 竞态检测参数：`-race` |
| `{{HTTP_MOCK_UTIL}}` | HTTP Mock 工具：`httptest.Server` |
| `{{FRAMEWORK_NAME}}` | 框架名称（从 {{FRAMEWORK_DESC}} 提取） |

### Go — go-zero

| 参数 | 值 |
|------|-----|
| `{{LANGUAGE_DESC}}` | Go、go-zero、一体化微服务框架（API/RPC） |
| `{{FRAMEWORK_VER}}` | go-zero 1.9.x |
| `{{LANGUAGE_RUNTIME}}` | Go 1.22+ |
| `{{BUILD_TOOL}}` | go mod + goctl |
| `{{TEST_FRAMEWORK}}` | go test + testify |
| `{{COV_TOOL}}` | go test -cover (核心逻辑 ≥80%) |
| `{{LINT_TOOL}}` | golangci-lint (go vet + staticcheck) |
| `{{ARCH_TEST_TOOL}}` | goimports + 自定义架构检查 |
| `{{DB_ACCESS}}` | GORM + goctl model |
| `{{LANG_TAG}}` | `-golang` |
| `{{HARNESS_ME_NAME}}` | `harness-me-golang` |
| `{{HARNESSING_CMD}}` | `/harnessing-golang` |
| `{{BUILD_CMD}}` | `goctl api go` + `go build ./...` |
| `{{TEST_CMD}}` | `go test ./...` |
| `{{LINT_CMD}}` | `golangci-lint run` |
| `{{DEV_CMD}}` | `go run <service>.go` |
| `{{DOCSTYLE}}` | Go 注释 |
| `{{FILE_LIMIT}}` | `800` |
| `{{ARCH_LAYER}}` | 服务间仅通过 RPC 通信，依赖方向 `common → models → rpc → api` |
| `{{TEST_NAMING}}` | `TestX_WhenY` |
| `{{MOCK_LIB}}` | `gomock` / `testify` / `goctl` |
| `{{COV_CMD}}` | `go test -cover` |
| `{{DEBUG_TOOL}}` | `delve` |
| `{{ARCH_REVIEW_CMD}}` | `/arch-review` |

### Go — Echo

| 参数 | 值 |
|------|-----|
| `{{LANGUAGE_DESC}}` | Go、Echo、极简高性能 HTTP 框架 |
| `{{FRAMEWORK_VER}}` | Echo v4 |
| `{{LANGUAGE_RUNTIME}}` | Go 1.22+ |
| `{{BUILD_TOOL}}` | go mod |
| `{{TEST_FRAMEWORK}}` | go test + testify |
| `{{COV_TOOL}}` | go test -cover (核心逻辑 ≥80%) |
| `{{LINT_TOOL}}` | golangci-lint (go vet + staticcheck) |
| `{{ARCH_TEST_TOOL}}` | goimports + 自定义架构检查 |
| `{{DB_ACCESS}}` | GORM / sqlx + golang-migrate |
| `{{LANG_TAG}}` | `-golang` |
| `{{HARNESS_ME_NAME}}` | `harness-me-golang` |
| `{{HARNESSING_CMD}}` | `/harnessing-golang` |
| `{{BUILD_CMD}}` | `go build ./...` |
| `{{TEST_CMD}}` | `go test ./...` |
| `{{LINT_CMD}}` | `golangci-lint run` |
| `{{DEV_CMD}}` | `go run ./cmd/server` |
| `{{DOCSTYLE}}` | Go 注释 |
| `{{FILE_LIMIT}}` | `800` |
| `{{ARCH_LAYER}}` | 分层 `handler → service → repository`，依赖单向 |
| `{{TEST_NAMING}}` | `TestX_WhenY` |
| `{{MOCK_LIB}}` | `gomock` / `testify` |
| `{{COV_CMD}}` | `go test -cover` |
| `{{DEBUG_TOOL}}` | `delve` |
| `{{ARCH_REVIEW_CMD}}` | `/arch-review` |

### Go — Fiber

| 参数 | 值 |
|------|-----|
| `{{LANGUAGE_DESC}}` | Go、Fiber、基于 fasthttp 的极速 Web 框架 |
| `{{FRAMEWORK_VER}}` | Fiber v2 |
| `{{LANGUAGE_RUNTIME}}` | Go 1.22+ |
| `{{BUILD_TOOL}}` | go mod |
| `{{TEST_FRAMEWORK}}` | go test + testify |
| `{{COV_TOOL}}` | go test -cover (核心逻辑 ≥80%) |
| `{{LINT_TOOL}}` | golangci-lint (go vet + staticcheck) |
| `{{ARCH_TEST_TOOL}}` | goimports + 自定义架构检查 |
| `{{DB_ACCESS}}` | GORM / sqlx + golang-migrate |
| `{{LANG_TAG}}` | `-golang` |
| `{{HARNESS_ME_NAME}}` | `harness-me-golang` |
| `{{HARNESSING_CMD}}` | `/harnessing-golang` |
| `{{BUILD_CMD}}` | `go build ./...` |
| `{{TEST_CMD}}` | `go test ./...` |
| `{{LINT_CMD}}` | `golangci-lint run` |
| `{{DEV_CMD}}` | `go run ./cmd/server` |
| `{{DOCSTYLE}}` | Go 注释 |
| `{{FILE_LIMIT}}` | `800` |
| `{{ARCH_LAYER}}` | 分层 `handler → service → repository`，依赖单向 |
| `{{TEST_NAMING}}` | `TestX_WhenY` |
| `{{MOCK_LIB}}` | `gomock` / `testify` |
| `{{COV_CMD}}` | `go test -cover` |
| `{{DEBUG_TOOL}}` | `delve` |
| `{{ARCH_REVIEW_CMD}}` | `/arch-review` |

### Go — Chi

| 参数 | 值 |
|------|-----|
| `{{LANGUAGE_DESC}}` | Go、Chi、轻量标准库风格路由器 |
| `{{FRAMEWORK_VER}}` | chi v5 |
| `{{LANGUAGE_RUNTIME}}` | Go 1.22+ |
| `{{BUILD_TOOL}}` | go mod |
| `{{TEST_FRAMEWORK}}` | go test + testify |
| `{{COV_TOOL}}` | go test -cover (核心逻辑 ≥80%) |
| `{{LINT_TOOL}}` | golangci-lint (go vet + staticcheck) |
| `{{ARCH_TEST_TOOL}}` | goimports + 自定义架构检查 |
| `{{DB_ACCESS}}` | GORM / sqlx + golang-migrate |
| `{{LANG_TAG}}` | `-golang` |
| `{{HARNESS_ME_NAME}}` | `harness-me-golang` |
| `{{HARNESSING_CMD}}` | `/harnessing-golang` |
| `{{BUILD_CMD}}` | `go build ./...` |
| `{{TEST_CMD}}` | `go test ./...` |
| `{{LINT_CMD}}` | `golangci-lint run` |
| `{{DEV_CMD}}` | `go run ./cmd/server` |
| `{{DOCSTYLE}}` | Go 注释 |
| `{{FILE_LIMIT}}` | `800` |
| `{{ARCH_LAYER}}` | 分层 `handler → service → repository`，依赖单向 |
| `{{TEST_NAMING}}` | `TestX_WhenY` |
| `{{MOCK_LIB}}` | `gomock` / `testify` |
| `{{COV_CMD}}` | `go test -cover` |
| `{{DEBUG_TOOL}}` | `delve` |
| `{{ARCH_REVIEW_CMD}}` | `/arch-review` |

---

### Frontend — Vue 3 + Vite

| 参数 | 值 |
|------|-----|
| `{{LANGUAGE}}` | `Frontend` |
| `{{LANGUAGE_DESC}}` | Vue 3、Vite、Pinia、Vue Router、TypeScript |
| `{{LANGUAGE_RUNTIME}}` | Node 20+ |
| `{{FRAMEWORK_VER}}` | Vue 3.x+ / Vite 5.x+ |
| `{{BUILD_TOOL}}` | npm/pnpm/yarn |
| `{{TEST_FRAMEWORK}}` | Vitest + @vue/test-utils |
| `{{COV_TOOL}}` | c8 / istanbul (核心逻辑 ≥80%) |
| `{{LINT_TOOL}}` | ESLint + Prettier + vue-tsc |
| `{{ARCH_TEST_TOOL}}` | ESLint import 规则 + 自定义检查 |
| `{{DB_ACCESS}}` | Pinia store + Axios 封装 |
| `{{LANG_TAG}}` | `-front` |
| `{{HARNESS_ME_NAME}}` | `harness-me-front` |
| `{{HARNESSING_CMD}}` | `/harnessing-front` |
| `{{BUILD_CMD}}` | `npm run build` |
| `{{TEST_CMD}}` | `npm run test` |
| `{{LINT_CMD}}` | `npm run lint` |
| `{{DEV_CMD}}` | `npm run dev` |
| `{{DOCSTYLE}}` | JSDoc / TSDoc |
| `{{FILE_LIMIT}}` | `400` |
| `{{ARCH_LAYER}}` | 依赖方向 `views → components → stores → services/api → models → utils` |
| `{{TEST_NAMING}}` | component/function 描述名 |
| `{{MOCK_LIB}}` | `vitest` mock / msw |
| `{{COV_CMD}}` | `npx vitest --coverage` |
| `{{DEBUG_TOOL}}` | 浏览器 DevTools / vue-devtools |
| `{{ARCH_REVIEW_CMD}}` | `/arch-review-front` |
| `{{ARCH_TEST_CMD}}` | 架构约束测试命令 |
| `{{SECURITY_CMD}}` | 安全扫描命令 |
| `{{INTEGRATION_CMD}}` | 集成测试命令 |
| `{{RUN_CMD}}` | 启动服务命令 |
| `{{HEALTH_CHECK_CMD}}` | 健康检查命令 |
| `{{HEALTH_ENDPOINT}}` | 健康检查端点 |
| `{{METRICS_ENDPOINT}}` | 指标端点 |
| `{{VET_CMD}}` | 静态分析命令：`eslint --fix` |
| `{{DEP_CMD}}` | 依赖管理命令：`npm install` |
| `{{ORM_TOOL}}` | ORM 框架：N/A |
| `{{TYPE_CHECK_TOOL}}` | 类型检查工具：`vue-tsc` / `tsc` |
| `{{TYPE_CHECK_CMD}}` | 类型检查命令：`{{TYPE_CHECK_TOOL}} --noEmit` |
| `{{FORMAT_TOOL}}` | 格式化工具：Prettier |
| `{{ASSERT_LIB}}` | 断言库：来自 {{TEST_FRAMEWORK}} |
| `{{RACE_DETECT_ARG}}` | 竞态检测参数：空 |
| `{{DEVTOOLS_TOOL}}` | DevTools：Vue Devtools / React DevTools / Angular DevTools |
| `{{ENV_LIB}}` | 测试环境库：`jsdom` |
| `{{UTIL_LIB}}` | 测试工具库：`@vue/test-utils` / `@testing-library/react` |
| `{{STATE_MGMT_LIB}}` | 状态管理库：Pinia / Redux / NgRx / Zustand |
| `{{API_FILE}}` | API 层文件：`request.ts` |
| `{{METRICS_CHECK_CMD}}` | 指标检查命令：N/A |
| `{{ROLLBACK_CMD}}` | 回滚命令：`npm run rollback` |

### Frontend — React + Vite

| 参数 | 值 |
|------|-----|
| `{{LANGUAGE_DESC}}` | React、Vite、TypeScript |
| `{{FRAMEWORK_VER}}` | React 18/19 + Vite 5.x+ |
| `{{LANGUAGE_RUNTIME}}` | Node 20+ |
| `{{BUILD_TOOL}}` | npm/pnpm/yarn |
| `{{TEST_FRAMEWORK}}` | Vitest + React Testing Library |
| `{{COV_TOOL}}` | c8 / istanbul (核心逻辑 ≥80%) |
| `{{LINT_TOOL}}` | ESLint + Prettier + typescript-eslint |
| `{{ARCH_TEST_TOOL}}` | ESLint import 规则 + 自定义检查 |
| `{{DB_ACCESS}}` | Redux / Zustand + Axios 封装 |
| `{{LANG_TAG}}` | `-front` |
| `{{HARNESS_ME_NAME}}` | `harness-me-front` |
| `{{HARNESSING_CMD}}` | `/harnessing-front` |
| `{{BUILD_CMD}}` | `npm run build` |
| `{{TEST_CMD}}` | `npm run test` |
| `{{LINT_CMD}}` | `npm run lint` |
| `{{DEV_CMD}}` | `npm run dev` |
| `{{DOCSTYLE}}` | JSDoc / TSDoc |
| `{{FILE_LIMIT}}` | `400` |
| `{{ARCH_LAYER}}` | 依赖方向 `pages → components → stores → services/api → models → utils` |
| `{{TEST_NAMING}}` | component/function 描述名 |
| `{{MOCK_LIB}}` | `vitest` mock / msw |
| `{{COV_CMD}}` | `npx vitest --coverage` |
| `{{DEBUG_TOOL}}` | 浏览器 DevTools / react-devtools |
| `{{ARCH_REVIEW_CMD}}` | `/arch-review-front` |

### Frontend — Next.js

| 参数 | 值 |
|------|-----|
| `{{LANGUAGE_DESC}}` | React、Next.js、全栈框架（App Router + RSC） |
| `{{FRAMEWORK_VER}}` | Next.js 15.x |
| `{{LANGUAGE_RUNTIME}}` | Node 20+ |
| `{{BUILD_TOOL}}` | npm/pnpm/yarn |
| `{{TEST_FRAMEWORK}}` | Vitest/Jest + React Testing Library |
| `{{COV_TOOL}}` | c8 / istanbul (核心逻辑 ≥80%) |
| `{{LINT_TOOL}}` | ESLint + Prettier + typescript-eslint |
| `{{ARCH_TEST_TOOL}}` | ESLint import 规则 + 自定义检查 |
| `{{DB_ACCESS}}` | Server Actions / Prisma + Axios 封装 |
| `{{LANG_TAG}}` | `-front` |
| `{{HARNESS_ME_NAME}}` | `harness-me-front` |
| `{{HARNESSING_CMD}}` | `/harnessing-front` |
| `{{BUILD_CMD}}` | `npm run build` |
| `{{TEST_CMD}}` | `npm run test` |
| `{{LINT_CMD}}` | `npm run lint` |
| `{{DEV_CMD}}` | `npm run dev` |
| `{{DOCSTYLE}}` | JSDoc / TSDoc |
| `{{FILE_LIMIT}}` | `400` |
| `{{ARCH_LAYER}}` | 依赖方向 `app(route) → components → lib/services → models → utils` |
| `{{TEST_NAMING}}` | component/function 描述名 |
| `{{MOCK_LIB}}` | `vitest` mock / msw |
| `{{COV_CMD}}` | `npx vitest --coverage` |
| `{{DEBUG_TOOL}}` | 浏览器 DevTools / react-devtools |
| `{{ARCH_REVIEW_CMD}}` | `/arch-review-front` |

### Frontend — Vue 3 + Vue CLI（Webpack）

| 参数 | 值 |
|------|-----|
| `{{LANGUAGE_DESC}}` | Vue 3、Vue CLI、Webpack |
| `{{FRAMEWORK_VER}}` | Vue 3.x + Vue CLI 5.x |
| `{{LANGUAGE_RUNTIME}}` | Node 20+ |
| `{{BUILD_TOOL}}` | npm/pnpm/yarn |
| `{{TEST_FRAMEWORK}}` | Jest + @vue/test-utils |
| `{{COV_TOOL}}` | istanbul (核心逻辑 ≥80%) |
| `{{LINT_TOOL}}` | ESLint + Prettier |
| `{{ARCH_TEST_TOOL}}` | ESLint import 规则 + 自定义检查 |
| `{{DB_ACCESS}}` | Pinia store + Axios 封装 |
| `{{LANG_TAG}}` | `-front` |
| `{{HARNESS_ME_NAME}}` | `harness-me-front` |
| `{{HARNESSING_CMD}}` | `/harnessing-front` |
| `{{BUILD_CMD}}` | `npm run build` |
| `{{TEST_CMD}}` | `npm run test` |
| `{{LINT_CMD}}` | `npm run lint` |
| `{{DEV_CMD}}` | `npm run serve` |
| `{{DOCSTYLE}}` | JSDoc / TSDoc |
| `{{FILE_LIMIT}}` | `400` |
| `{{ARCH_LAYER}}` | 依赖方向 `views → components → stores → services/api → models → utils` |
| `{{TEST_NAMING}}` | component/function 描述名 |
| `{{MOCK_LIB}}` | Jest mock / msw |
| `{{COV_CMD}}` | `npx jest --coverage` |
| `{{DEBUG_TOOL}}` | 浏览器 DevTools / vue-devtools |
| `{{ARCH_REVIEW_CMD}}` | `/arch-review-front` |

### Frontend — Angular

| 参数 | 值 |
|------|-----|
| `{{LANGUAGE_DESC}}` | Angular、Angular CLI、TypeScript |
| `{{FRAMEWORK_VER}}` | Angular 18+ |
| `{{LANGUAGE_RUNTIME}}` | Node 20+ |
| `{{BUILD_TOOL}}` | npm/pnpm/yarn |
| `{{TEST_FRAMEWORK}}` | Jasmine + Karma / Jest |
| `{{COV_TOOL}}` | Karma 覆盖率 / istanbul (核心逻辑 ≥80%) |
| `{{LINT_TOOL}}` | ESLint + Prettier |
| `{{ARCH_TEST_TOOL}}` | ESLint import 规则 + 自定义检查 |
| `{{DB_ACCESS}}` | NgRx / Signal + Axios 封装 |
| `{{LANG_TAG}}` | `-front` |
| `{{HARNESS_ME_NAME}}` | `harness-me-front` |
| `{{HARNESSING_CMD}}` | `/harnessing-front` |
| `{{BUILD_CMD}}` | `npm run build` |
| `{{TEST_CMD}}` | `npm run test` |
| `{{LINT_CMD}}` | `npm run lint` |
| `{{DEV_CMD}}` | `npm run start` |
| `{{DOCSTYLE}}` | JSDoc / TSDoc |
| `{{FILE_LIMIT}}` | `400` |
| `{{ARCH_LAYER}}` | 依赖方向 `components → services → models → utils`，模块化分层 |
| `{{TEST_NAMING}}` | component/function 描述名 |
| `{{MOCK_LIB}}` | Jasmine spies / Jest mock |
| `{{COV_CMD}}` | `npx ng test --code-coverage` |
| `{{DEBUG_TOOL}}` | 浏览器 DevTools / Angular DevTools |
| `{{ARCH_REVIEW_CMD}}` | `/arch-review-front` |

### Frontend — Svelte + Vite

| 参数 | 值 |
|------|-----|
| `{{LANGUAGE_DESC}}` | Svelte、Vite、TypeScript |
| `{{FRAMEWORK_VER}}` | Svelte 5.x + Vite 5.x+ |
| `{{LANGUAGE_RUNTIME}}` | Node 20+ |
| `{{BUILD_TOOL}}` | npm/pnpm/yarn |
| `{{TEST_FRAMEWORK}}` | Vitest + @testing-library/svelte |
| `{{COV_TOOL}}` | c8 / istanbul (核心逻辑 ≥80%) |
| `{{LINT_TOOL}}` | ESLint + Prettier + svelte-check |
| `{{ARCH_TEST_TOOL}}` | ESLint import 规则 + 自定义检查 |
| `{{DB_ACCESS}}` | Svelte stores + Axios 封装 |
| `{{LANG_TAG}}` | `-front` |
| `{{HARNESS_ME_NAME}}` | `harness-me-front` |
| `{{HARNESSING_CMD}}` | `/harnessing-front` |
| `{{BUILD_CMD}}` | `npm run build` |
| `{{TEST_CMD}}` | `npm run test` |
| `{{LINT_CMD}}` | `npm run lint` |
| `{{DEV_CMD}}` | `npm run dev` |
| `{{DOCSTYLE}}` | JSDoc / TSDoc |
| `{{FILE_LIMIT}}` | `400` |
| `{{ARCH_LAYER}}` | 依赖方向 `pages → components → stores → services/api → models → utils` |
| `{{TEST_NAMING}}` | component/function 描述名 |
| `{{MOCK_LIB}}` | `vitest` mock / msw |
| `{{COV_CMD}}` | `npx vitest --coverage` |
| `{{DEBUG_TOOL}}` | 浏览器 DevTools / Svelte DevTools |
| `{{ARCH_REVIEW_CMD}}` | `/arch-review-front` |

### Frontend — Nuxt

| 参数 | 值 |
|------|-----|
| `{{LANGUAGE_DESC}}` | Vue、Nuxt、全栈框架（SSR/SSG + 自动导入） |
| `{{FRAMEWORK_VER}}` | Nuxt 4.x |
| `{{LANGUAGE_RUNTIME}}` | Node 20+ |
| `{{BUILD_TOOL}}` | npm/pnpm/yarn |
| `{{TEST_FRAMEWORK}}` | Vitest + @vue/test-utils |
| `{{COV_TOOL}}` | c8 / istanbul (核心逻辑 ≥80%) |
| `{{LINT_TOOL}}` | ESLint + Prettier + vue-tsc |
| `{{ARCH_TEST_TOOL}}` | ESLint import 规则 + 自定义检查 |
| `{{DB_ACCESS}}` | Pinia store + Nitro API + Axios 封装 |
| `{{LANG_TAG}}` | `-front` |
| `{{HARNESS_ME_NAME}}` | `harness-me-front` |
| `{{HARNESSING_CMD}}` | `/harnessing-front` |
| `{{BUILD_CMD}}` | `npm run build` |
| `{{TEST_CMD}}` | `npm run test` |
| `{{LINT_CMD}}` | `npm run lint` |
| `{{DEV_CMD}}` | `npm run dev` |
| `{{DOCSTYLE}}` | JSDoc / TSDoc |
| `{{FILE_LIMIT}}` | `400` |
| `{{ARCH_LAYER}}` | 依赖方向 `pages → components → composables → server/api → utils` |
| `{{TEST_NAMING}}` | component/function 描述名 |
| `{{MOCK_LIB}}` | `vitest` mock / msw |
| `{{COV_CMD}}` | `npx vitest --coverage` |
| `{{DEBUG_TOOL}}` | 浏览器 DevTools / vue-devtools |
| `{{ARCH_REVIEW_CMD}}` | `/arch-review-front` |

### Frontend — React + CRA（Webpack）

| 参数 | 值 |
|------|-----|
| `{{LANGUAGE_DESC}}` | React、Create React App、Webpack |
| `{{FRAMEWORK_VER}}` | React 18 + CRA 5.x |
| `{{LANGUAGE_RUNTIME}}` | Node 20+ |
| `{{BUILD_TOOL}}` | npm/pnpm/yarn |
| `{{TEST_FRAMEWORK}}` | Jest + React Testing Library |
| `{{COV_TOOL}}` | istanbul (核心逻辑 ≥80%) |
| `{{LINT_TOOL}}` | ESLint + Prettier |
| `{{ARCH_TEST_TOOL}}` | ESLint import 规则 + 自定义检查 |
| `{{DB_ACCESS}}` | Redux / Zustand + Axios 封装 |
| `{{LANG_TAG}}` | `-front` |
| `{{HARNESS_ME_NAME}}` | `harness-me-front` |
| `{{HARNESSING_CMD}}` | `/harnessing-front` |
| `{{BUILD_CMD}}` | `npm run build` |
| `{{TEST_CMD}}` | `npm run test` |
| `{{LINT_CMD}}` | `npm run lint` |
| `{{DEV_CMD}}` | `npm run start` |
| `{{DOCSTYLE}}` | JSDoc / TSDoc |
| `{{FILE_LIMIT}}` | `400` |
| `{{ARCH_LAYER}}` | 依赖方向 `pages → components → stores → services/api → models → utils` |
| `{{TEST_NAMING}}` | component/function 描述名 |
| `{{MOCK_LIB}}` | Jest mock / msw |
| `{{COV_CMD}}` | `npx react-scripts test --coverage` |
| `{{DEBUG_TOOL}}` | 浏览器 DevTools / react-devtools |
| `{{ARCH_REVIEW_CMD}}` | `/arch-review-front` |

### Frontend — 纯 Vite（无前端框架）

| 参数 | 值 |
|------|-----|
| `{{LANGUAGE_DESC}}` | 纯 Vite、TypeScript |
| `{{FRAMEWORK_VER}}` | Vite 5.x+ |
| `{{LANGUAGE_RUNTIME}}` | Node 20+ |
| `{{BUILD_TOOL}}` | npm/pnpm/yarn |
| `{{TEST_FRAMEWORK}}` | Vitest |
| `{{COV_TOOL}}` | c8 / istanbul (核心逻辑 ≥80%) |
| `{{LINT_TOOL}}` | ESLint + Prettier |
| `{{ARCH_TEST_TOOL}}` | ESLint import 规则 + 自定义检查 |
| `{{DB_ACCESS}}` | 无特定状态管理 |
| `{{LANG_TAG}}` | `-front` |
| `{{HARNESS_ME_NAME}}` | `harness-me-front` |
| `{{HARNESSING_CMD}}` | `/harnessing-front` |
| `{{BUILD_CMD}}` | `npm run build` |
| `{{TEST_CMD}}` | `npm run test` |
| `{{LINT_CMD}}` | `npm run lint` |
| `{{DEV_CMD}}` | `npm run dev` |
| `{{DOCSTYLE}}` | JSDoc / TSDoc |
| `{{FILE_LIMIT}}` | `400` |
| `{{ARCH_LAYER}}` | 依赖方向 `src → components → utils` |
| `{{TEST_NAMING}}` | function 描述名 |
| `{{MOCK_LIB}}` | `vitest` mock |
| `{{COV_CMD}}` | `npx vitest --coverage` |
| `{{DEBUG_TOOL}}` | 浏览器 DevTools |
| `{{ARCH_REVIEW_CMD}}` | `/arch-review-front` |

### 参数块使用说明（差异化）

> 以下参数块采用**差异化**写法：每个语言先给出「基础参数」，各框架块只列出与基础不同的参数（未列出的继承基础）。ML/AI/LLM 框架无传统 Web 分层与数据库访问，ARCH_LAYER/DB_ACCESS 改为其适用含义。

### Java 基础参数（JDK 21 + Maven Web 家族通用）

| 参数 | 值 |
|------|-----|
| `{{LANGUAGE}}` | `Java` |
| `{{LANGUAGE_RUNTIME}}` | JDK 21 LTS |
| `{{TEST_FRAMEWORK}}` | JUnit 5 + Mockito + AssertJ |
| `{{COV_TOOL}}` | JaCoCo (核心逻辑 ≥80%) |
| `{{LINT_TOOL}}` | Checkstyle + PMD + SpotBugs |
| `{{ARCH_TEST_TOOL}}` | ArchUnit |
| `{{LANG_TAG}}` | `-java` |
| `{{HARNESS_ME_NAME}}` | `harness-me` |
| `{{HARNESSING_CMD}}` | `/harnessing` |
| `{{BUILD_CMD}}` | `mvn compile` |
| `{{TEST_CMD}}` | `mvn test` |
| `{{LINT_CMD}}` | `mvn checkstyle:check` |
| `{{COV_CMD}}` | `mvn jacoco:report` |
| `{{DOCSTYLE}}` | `Javadoc` |
| `{{FILE_LIMIT}}` | `500` |
| `{{TEST_NAMING}}` | `method_should_x_when_y` |
| `{{MOCK_LIB}}` | `Mockito` |
| `{{DEBUG_TOOL}}` | 调试器 / `jdb` |
| `{{ARCH_REVIEW_CMD}}` | `/arch-review` |
| `{{ARCH_TEST_CMD}}` | 架构约束测试命令 |
| `{{SECURITY_CMD}}` | 安全扫描命令 |
| `{{INTEGRATION_CMD}}` | 集成测试命令 |
| `{{RUN_CMD}}` | 启动服务命令 |
| `{{HEALTH_CHECK_CMD}}` | 健康检查命令 |
| `{{HEALTH_ENDPOINT}}` | 健康检查端点 |
| `{{METRICS_ENDPOINT}}` | 指标端点 |
| `{{VET_CMD}}` | 静态分析命令（实际合并到 LINT_CMD） |
| `{{DEP_CMD}}` | 依赖管理命令：`mvn dependency:tree` |
| `{{ORM_TOOL}}` | ORM 框架：MyBatis-Plus / JPA |
| `{{TYPE_CHECK_TOOL}}` | 类型检查工具：javac（编译时检查） |
| `{{TYPE_CHECK_CMD}}` | 类型检查命令：`{{BUILD_CMD}}` |
| `{{ASSERT_LIB}}` | 断言库：AssertJ |
| `{{RACE_DETECT_ARG}}` | 竞态检测参数：空 |

### Java — Dubbo（微服务 RPC）

| 参数 | 值 |
|------|-----|
| `{{LANGUAGE_DESC}}` | Java、Dubbo、微服务 RPC 架构 |
| `{{FRAMEWORK_VER}}` | Dubbo 3.x |
| `{{DEV_CMD}}` | `mvn dubbo:run` / 启动 Provider |
| `{{ARCH_LAYER}}` | Provider/Consumer 通过 RPC 接口通信，禁止直接依赖实现 |
| `{{DB_ACCESS}}` | MyBatis-Plus / JPA + Flyway |

### Java — Spring Cloud Alibaba

| 参数 | 值 |
|------|-----|
| `{{LANGUAGE_DESC}}` | Java、Spring Cloud Alibaba、微服务生态（Nacos/Sentinel/Seata） |
| `{{FRAMEWORK_VER}}` | Spring Cloud 2023.x + Alibaba |
| `{{DEV_CMD}}` | `mvn spring-boot:run` |
| `{{ARCH_LAYER}}` | 服务间通过 OpenFeign/RestTemplate 通信，网关 → 微服务 → 注册中心 |
| `{{DB_ACCESS}}` | MyBatis-Plus / JPA + Flyway |

### Java — Spring AI（LLM 应用）

| 参数 | 值 |
|------|-----|
| `{{LANGUAGE_DESC}}` | Java、Spring AI、LLM/RAG 应用框架 |
| `{{FRAMEWORK_VER}}` | Spring AI 1.0.x |
| `{{DEV_CMD}}` | `mvn spring-boot:run` |
| `{{ARCH_LAYER}}` | Controller → Service → AI Client（绑定 Model/Vector Store） |
| `{{DB_ACCESS}}` | 向量库（PgVector/Redis） + 元数据存储 |

### Java — Spring AI Alibaba

| 参数 | 值 |
|------|-----|
| `{{LANGUAGE_DESC}}` | Java、Spring AI Alibaba、阿里云百炼 LLM 应用 |
| `{{FRAMEWORK_VER}}` | Spring AI Alibaba 1.0.x |
| `{{DEV_CMD}}` | `mvn spring-boot:run` |
| `{{ARCH_LAYER}}` | Controller → Service → AI Client（百炼 Model + Vector Store） |
| `{{DB_ACCESS}}` | 向量库 + 元数据存储 |

### Java — AgentScope Java（多 Agent）

| 参数 | 值 |
|------|-----|
| `{{LANGUAGE_DESC}}` | Java、AgentScope、多 Agent 协同框架 |
| `{{FRAMEWORK_VER}}` | AgentScope Java |
| `{{DEV_CMD}}` | `mvn spring-boot:run` |
| `{{ARCH_LAYER}}` | Agent → Tool → LLM，Agent 间通过消息通信 |
| `{{DB_ACCESS}}` | 向量库 / 会话存储 |

### Java — LangChain4j（LLM 编排）

| 参数 | 值 |
|------|-----|
| `{{LANGUAGE_DESC}}` | Java、LangChain4j、LLM 编排与 RAG 框架 |
| `{{FRAMEWORK_VER}}` | langchain4j 1.x |
| `{{DEV_CMD}}` | `mvn spring-boot:run` |
| `{{ARCH_LAYER}}` | 分层 controller → service → langchain4j(chain/agent/tool) |
| `{{DB_ACCESS}}` | 向量库（PgVector/OpenSearch） + 嵌入式存储 |

### Java — Semantic Kernel（AI 编排）

| 参数 | 值 |
|------|-----|
| `{{LANGUAGE_DESC}}` | Java、Semantic Kernel、AI 编排与技能框架 |
| `{{FRAMEWORK_VER}}` | Semantic Kernel Java 版 |
| `{{DEV_CMD}}` | `mvn spring-boot:run` |
| `{{ARCH_LAYER}}` | Kernel → Plugin → Connector，插件化组织 |
| `{{DB_ACCESS}}` | 向量库 / 内存存储 |

### Java — Genkit Java（AI 后端）

| 参数 | 值 |
|------|-----|
| `{{LANGUAGE_DESC}}` | Java、Firebase Genkit、AI 后端工具链 |
| `{{FRAMEWORK_VER}}` | Genkit Java 版 |
| `{{DEV_CMD}}` | `mvn spring-boot:run` |
| `{{ARCH_LAYER}}` | Flow → Tool → LLM，Flow 编排 AI 逻辑 |
| `{{DB_ACCESS}}` | 向量库 / 会话存储 |

---

### Python 基础参数（通用）

| 参数 | 值 |
|------|-----|
| `{{LANGUAGE}}` | `Python` |
| `{{LANGUAGE_RUNTIME}}` | Python 3.11+ |
| `{{COV_TOOL}}` | pytest-cov (核心逻辑 ≥80%) |
| `{{LINT_TOOL}}` | flake8 + mypy + black + isort |
| `{{LANG_TAG}}` | `-python` |
| `{{HARNESS_ME_NAME}}` | `harness-me-python` |
| `{{HARNESSING_CMD}}` | `/harnessing-python` |
| `{{BUILD_CMD}}` | `python -m compileall .` |
| `{{TEST_CMD}}` | `python -m pytest` |
| `{{LINT_CMD}}` | `flake8 .` |
| `{{COV_CMD}}` | `pytest --cov` |
| `{{DOCSTYLE}}` | `docstring` |
| `{{FILE_LIMIT}}` | `800` |
| `{{TEST_NAMING}}` | `test_x_when_y` |
| `{{DEBUG_TOOL}}` | `pdb` / `breakpoint()` / `ipdb` |
| `{{ARCH_REVIEW_CMD}}` | `/arch-review-python` |
| `{{ARCH_TEST_CMD}}` | 架构约束测试命令 |
| `{{SECURITY_CMD}}` | 安全扫描命令 |
| `{{INTEGRATION_CMD}}` | 集成测试命令 |
| `{{RUN_CMD}}` | 启动服务命令 |
| `{{HEALTH_CHECK_CMD}}` | 健康检查命令 |
| `{{HEALTH_ENDPOINT}}` | 健康检查端点 |
| `{{METRICS_ENDPOINT}}` | 指标端点 |
| `{{VET_CMD}}` | 静态分析命令：`mypy` |
| `{{DEP_CMD}}` | 依赖管理命令：`pip install` / `poetry add` |
| `{{ORM_TOOL}}` | ORM 框架：SQLAlchemy |
| `{{TYPE_CHECK_TOOL}}` | 类型检查工具：mypy |
| `{{TYPE_CHECK_CMD}}` | 类型检查命令：`mypy` |
| `{{FORMAT_TOOL}}` | 格式化工具：black |
| `{{FORMAT_CHECK_CMD}}` | 格式检查命令：`black --check .` |
| `{{METRICS_CHECK_CMD}}` | 指标检查命令：`curl {{METRICS_ENDPOINT}}` |
| `{{ASSERT_LIB}}` | 断言库：`assert` |
| `{{RACE_DETECT_ARG}}` | 竞态检测参数：空 |

### Python — Tornado（异步 Web）

| 参数 | 值 |
|------|-----|
| `{{LANGUAGE_DESC}}` | Python、Tornado、异步非阻塞 Web 框架 |
| `{{FRAMEWORK_VER}}` | Tornado 6.x |
| `{{BUILD_TOOL}}` | pip / poetry / uv |
| `{{ARCH_TEST_TOOL}}` | 自定义 import-lint 检查 |
| `{{DB_ACCESS}}` | SQLAlchemy + Alembic |
| `{{DEV_CMD}}` | `python -m tornado.autoreload main.py` |
| `{{ARCH_LAYER}}` | 依赖方向 RequestHandler → service → model |
| `{{MOCK_LIB}}` | `pytest-mock` |

### Python — TensorFlow（深度学习）

| 参数 | 值 |
|------|-----|
| `{{LANGUAGE_DESC}}` | Python、TensorFlow、深度学习框架 |
| `{{FRAMEWORK_VER}}` | TensorFlow 2.x |
| `{{BUILD_TOOL}}` | pip / poetry / uv |
| `{{ARCH_TEST_TOOL}}` | 自定义 import-lint 检查 |
| `{{DB_ACCESS}}` | 数据集管道（tf.data）+ 模型检查点 |
| `{{DEV_CMD}}` | `python -m pytest`（训练脚本按需运行） |
| `{{ARCH_LAYER}}` | 数据加载 → 模型构建 → 训练/评估 → 服务导出 |
| `{{MOCK_LIB}}` | `pytest-mock` |

### Python — PyTorch（深度学习）

| 参数 | 值 |
|------|-----|
| `{{LANGUAGE_DESC}}` | Python、PyTorch、深度学习框架 |
| `{{FRAMEWORK_VER}}` | PyTorch 2.x |
| `{{BUILD_TOOL}}` | pip / poetry / uv |
| `{{ARCH_TEST_TOOL}}` | 自定义 import-lint 检查 |
| `{{DB_ACCESS}}` | DataLoader 数据集 + 模型检查点 |
| `{{DEV_CMD}}` | `python -m pytest` |
| `{{ARCH_LAYER}}` | 数据加载 → 模型构建 → 训练/评估 → 服务导出 |
| `{{MOCK_LIB}}` | `pytest-mock` |

### Python — Keras（高层 API）

| 参数 | 值 |
|------|-----|
| `{{LANGUAGE_DESC}}` | Python、Keras、高层深度学习 API |
| `{{FRAMEWORK_VER}}` | Keras 3.x |
| `{{BUILD_TOOL}}` | pip / poetry / uv |
| `{{ARCH_TEST_TOOL}}` | 自定义 import-lint 检查 |
| `{{DB_ACCESS}}` | 数据集 + 模型检查点 |
| `{{DEV_CMD}}` | `python -m pytest` |
| `{{ARCH_LAYER}}` | 数据加载 → 模型构建 → 训练/评估 |
| `{{MOCK_LIB}}` | `pytest-mock` |

### Python — scikit-learn（机器学习）

| 参数 | 值 |
|------|-----|
| `{{LANGUAGE_DESC}}` | Python、scikit-learn、经典机器学习库 |
| `{{FRAMEWORK_VER}}` | scikit-learn 1.x |
| `{{BUILD_TOOL}}` | pip / poetry / uv |
| `{{ARCH_TEST_TOOL}}` | 自定义 import-lint 检查 |
| `{{DB_ACCESS}}` | 数据集 + 模型持久化（joblib/pickle） |
| `{{DEV_CMD}}` | `python -m pytest` |
| `{{ARCH_LAYER}}` | 数据预处理 → 特征工程 → 建模 → 评估 |
| `{{MOCK_LIB}}` | `pytest-mock` |

### Python — XGBoost（梯度提升）

| 参数 | 值 |
|------|-----|
| `{{LANGUAGE_DESC}}` | Python、XGBoost、梯度提升树库 |
| `{{FRAMEWORK_VER}}` | XGBoost 2.x |
| `{{BUILD_TOOL}}` | pip / poetry / uv |
| `{{ARCH_TEST_TOOL}}` | 自定义 import-lint 检查 |
| `{{DB_ACCESS}}` | 数据集 + 模型持久化 |
| `{{DEV_CMD}}` | `python -m pytest` |
| `{{ARCH_LAYER}}` | 数据处理 → 建模 → 评估 |
| `{{MOCK_LIB}}` | `pytest-mock` |

### Python — Hugging Face Transformers（NLP）

| 参数 | 值 |
|------|-----|
| `{{LANGUAGE_DESC}}` | Python、Hugging Face Transformers、预训练模型库 |
| `{{FRAMEWORK_VER}}` | transformers 4.x |
| `{{BUILD_TOOL}}` | pip / poetry / uv |
| `{{ARCH_TEST_TOOL}}` | 自定义 import-lint 检查 |
| `{{DB_ACCESS}}` | 预训练模型 + 数据集（datasets） |
| `{{DEV_CMD}}` | `python -m pytest` |
| `{{ARCH_LAYER}}` | 数据加载 → 模型加载 → fine-tune → 推理 |
| `{{MOCK_LIB}}` | `pytest-mock` |

### Python — LangChain（LLM 应用）

| 参数 | 值 |
|------|-----|
| `{{LANGUAGE_DESC}}` | Python、LangChain、LLM 应用编排框架 |
| `{{FRAMEWORK_VER}}` | LangChain 0.3.x / 1.x |
| `{{BUILD_TOOL}}` | pip / poetry / uv |
| `{{ARCH_TEST_TOOL}}` | 自定义 import-lint 检查 |
| `{{DB_ACCESS}}` | 向量库（Chroma/Pinecone） + LangSmith 追踪 |
| `{{DEV_CMD}}` | `python -m pytest` |
| `{{ARCH_LAYER}}` | Chain → Model → Tool/Retriever，链式编排 |
| `{{MOCK_LIB}}` | `pytest-mock` |

### Python — LangGraph（Agent 图）

| 参数 | 值 |
|------|-----|
| `{{LANGUAGE_DESC}}` | Python、LangGraph、有状态多 Agent 图编排 |
| `{{FRAMEWORK_VER}}` | LangGraph 1.x |
| `{{BUILD_TOOL}}` | pip / poetry / uv |
| `{{ARCH_TEST_TOOL}}` | 自定义 import-lint 检查 |
| `{{DB_ACCESS}}` | 向量库 + 状态存储（Checkpointer） |
| `{{DEV_CMD}}` | `python -m pytest` |
| `{{ARCH_LAYER}}` | StateGraph 节点 → 边，Agent 状态机编排 |
| `{{MOCK_LIB}}` | `pytest-mock` |

### Python — CrewAI（Agent 团队）

| 参数 | 值 |
|------|-----|
| `{{LANGUAGE_DESC}}` | Python、CrewAI、多 Agent 协作框架 |
| `{{FRAMEWORK_VER}}` | CrewAI 0.x |
| `{{BUILD_TOOL}}` | pip / poetry / uv |
| `{{ARCH_TEST_TOOL}}` | 自定义 import-lint 检查 |
| `{{DB_ACCESS}}` | 向量库 + 任务/会话存储 |
| `{{DEV_CMD}}` | `python -m pytest` |
| `{{ARCH_LAYER}}` | Agent + Task + Crew/Process，角色化协作 |
| `{{MOCK_LIB}}` | `pytest-mock` |

### Python — PydanticAI（AI Agent）

| 参数 | 值 |
|------|-----|
| `{{LANGUAGE_DESC}}` | Python、PydanticAI、类型安全 AI Agent 框架 |
| `{{FRAMEWORK_VER}}` | pydantic-ai |
| `{{BUILD_TOOL}}` | pip / poetry / uv |
| `{{ARCH_TEST_TOOL}}` | 自定义 import-lint 检查 |
| `{{DB_ACCESS}}` | 向量库 / 会话存储 |
| `{{DEV_CMD}}` | `python -m pytest` |
| `{{ARCH_LAYER}}` | Agent → Tool → Model，Pydantic 结构化输出 |
| `{{MOCK_LIB}}` | `pytest-mock` |

### Python — SmolAgents（轻量 Agent）

| 参数 | 值 |
|------|-----|
| `{{LANGUAGE_DESC}}` | Python、SmolAgents、轻量 Agent 框架 |
| `{{FRAMEWORK_VER}}` | smolagents |
| `{{BUILD_TOOL}}` | pip / poetry / uv |
| `{{ARCH_TEST_TOOL}}` | 自定义 import-lint 检查 |
| `{{DB_ACCESS}}` | 向量库 / 会话存储 |
| `{{DEV_CMD}}` | `python -m pytest` |
| `{{ARCH_LAYER}}` | Agent → Tool → Model，轻量编排 |
| `{{MOCK_LIB}}` | `pytest-mock` |

### Python — OpenAI Agents SDK（Agent）

| 参数 | 值 |
|------|-----|
| `{{LANGUAGE_DESC}}` | Python、OpenAI Agents SDK、Agent 编排框架 |
| `{{FRAMEWORK_VER}}` | openai-agents |
| `{{BUILD_TOOL}}` | pip / poetry / uv |
| `{{ARCH_TEST_TOOL}}` | 自定义 import-lint 检查 |
| `{{DB_ACCESS}}` | 向量库 / 会话存储 |
| `{{DEV_CMD}}` | `python -m pytest` |
| `{{ARCH_LAYER}}` | Agent → Handoff → Guardrail → Tool，层级编排 |
| `{{MOCK_LIB}}` | `pytest-mock` |

---

### Go 基础参数（通用）

| 参数 | 值 |
|------|-----|
| `{{LANGUAGE}}` | `Go` |
| `{{LANGUAGE_RUNTIME}}` | Go 1.22+ |
| `{{COV_TOOL}}` | go test -cover (核心逻辑 ≥80%) |
| `{{LINT_TOOL}}` | golangci-lint (go vet + staticcheck) |
| `{{ARCH_TEST_TOOL}}` | goimports + 自定义架构检查 |
| `{{LANG_TAG}}` | `-golang` |
| `{{HARNESS_ME_NAME}}` | `harness-me-golang` |
| `{{HARNESSING_CMD}}` | `/harnessing-golang` |
| `{{BUILD_CMD}}` | `go build ./...` |
| `{{TEST_CMD}}` | `go test ./...` |
| `{{LINT_CMD}}` | `golangci-lint run` |
| `{{COV_CMD}}` | `go test -cover` |
| `{{DOCSTYLE}}` | Go 注释 |
| `{{FILE_LIMIT}}` | `800` |
| `{{TEST_NAMING}}` | `TestX_WhenY` |
| `{{DEBUG_TOOL}}` | `delve` |
| `{{ARCH_REVIEW_CMD}}` | `/arch-review` |
| `{{ARCH_TEST_CMD}}` | 架构约束测试命令 |
| `{{SECURITY_CMD}}` | 安全扫描命令 |
| `{{INTEGRATION_CMD}}` | 集成测试命令 |
| `{{RUN_CMD}}` | 启动服务命令 |
| `{{HEALTH_CHECK_CMD}}` | 健康检查命令 |
| `{{HEALTH_ENDPOINT}}` | 健康检查端点 |
| `{{METRICS_ENDPOINT}}` | 指标端点 |
| `{{VET_CMD}}` | 静态分析命令：`go vet ./...` |
| `{{DEP_CMD}}` | 依赖管理命令：`go mod tidy` |
| `{{ORM_TOOL}}` | ORM 框架：GORM / sqlx |
| `{{TYPE_CHECK_TOOL}}` | 类型检查工具：go vet |
| `{{TYPE_CHECK_CMD}}` | 类型检查命令：`go vet ./...` |
| `{{ASSERT_LIB}}` | 断言库：testify |
| `{{RACE_DETECT_ARG}}` | 竞态检测参数：`-race` |
| `{{HTTP_MOCK_UTIL}}` | HTTP Mock 工具：`httptest.Server` |
| `{{FRAMEWORK_NAME}}` | 框架名称（从 {{FRAMEWORK_DESC}} 提取） |

### Go — Beego

| 参数 | 值 |
|------|-----|
| `{{LANGUAGE_DESC}}` | Go、Beego、全栈 Go Web 框架 |
| `{{FRAMEWORK_VER}}` | Beego 2.x |
| `{{DEV_CMD}}` | `go run main.go` |
| `{{ARCH_LAYER}}` | 分层 controller → models/services → ORM，依赖单向 |
| `{{DB_ACCESS}}` | Beego ORM + 迁移 |

### Go — Go-Kit

| 参数 | 值 |
|------|-----|
| `{{LANGUAGE_DESC}}` | Go、Go-Kit、微服务工具箱 |
| `{{FRAMEWORK_VER}}` | Go-Kit 0.13.x |
| `{{DEV_CMD}}` | `go run ./cmd/` |
| `{{ARCH_LAYER}}` | Transport → Endpoint → Service（Go-Kit 三层） |
| `{{DB_ACCESS}}` | GORM / sqlx + golang-migrate |

### Go — Go-Kratos

| 参数 | 值 |
|------|-----|
| `{{LANGUAGE_DESC}}` | Go、Go-Kratos、微服务框架 |
| `{{FRAMEWORK_VER}}` | Kratos v2 |
| `{{DEV_CMD}}` | `go run service-api/main.go` |
| `{{ARCH_LAYER}}` | 分层 api → service → biz → data（Kratos 标准） |
| `{{DB_ACCESS}}` | GORM + ent + golang-migrate |

### Go — Gorilla Mux

| 参数 | 值 |
|------|-----|
| `{{LANGUAGE_DESC}}` | Go、Gorilla Mux、标准库风格路由器 |
| `{{FRAMEWORK_VER}}` | gorilla/mux v1 |
| `{{DEV_CMD}}` | `go run ./cmd/server` |
| `{{ARCH_LAYER}}` | 分层 handler → service → repository，依赖单向 |
| `{{DB_ACCESS}}` | GORM / sqlx + golang-migrate |

### Go — Kitex（RPC）

| 参数 | 值 |
|------|-----|
| `{{LANGUAGE_DESC}}` | Go、Kitex、字节高性能 RPC 框架 |
| `{{FRAMEWORK_VER}}` | Kitex 0.x |
| `{{DEV_CMD}}` | `go run .` |
| `{{ARCH_LAYER}}` | Client/Server 通过 IDL 生成代码通信，禁止直接耦合 |
| `{{DB_ACCESS}}` | GORM / sqlx + golang-migrate |

### Go — Hertz（HTTP）

| 参数 | 值 |
|------|-----|
| `{{LANGUAGE_DESC}}` | Go、Hertz、字节高性能 HTTP 框架 |
| `{{FRAMEWORK_VER}}` | Hertz v0.x |
| `{{DEV_CMD}}` | `go run .` |
| `{{ARCH_LAYER}}` | 分层 handler → service → repository，依赖单向 |
| `{{DB_ACCESS}}` | GORM / sqlx + golang-migrate |

### Go — Iris

| 参数 | 值 |
|------|-----|
| `{{LANGUAGE_DESC}}` | Go、Iris、Web 框架 |
| `{{FRAMEWORK_VER}}` | Iris v12 |
| `{{DEV_CMD}}` | `go run main.go` |
| `{{ARCH_LAYER}}` | 分层 handler → service → repository，依赖单向 |
| `{{DB_ACCESS}}` | GORM / sqlx + golang-migrate |

### Go — Macaron

| 参数 | 值 |
|------|-----|
| `{{LANGUAGE_DESC}}` | Go、Macaron、轻量 Web 框架 |
| `{{FRAMEWORK_VER}}` | Macaron v1 |
| `{{DEV_CMD}}` | `go run main.go` |
| `{{ARCH_LAYER}}` | 分层 handler → service → repository，依赖单向 |
| `{{DB_ACCESS}}` | GORM / sqlx + golang-migrate |

### Go — Tango

| 参数 | 值 |
|------|-----|
| `{{LANGUAGE_DESC}}` | Go、Tango、轻量 Web 框架 |
| `{{FRAMEWORK_VER}}` | Tango |
| `{{DEV_CMD}}` | `go run main.go` |
| `{{ARCH_LAYER}}` | 分层 handler → service → repository，依赖单向 |
| `{{DB_ACCESS}}` | GORM / sqlx + golang-migrate |

### Go — goframe

| 参数 | 值 |
|------|-----|
| `{{LANGUAGE_DESC}}` | Go、GoFrame、全栈 Web 开发框架 |
| `{{FRAMEWORK_VER}}` | GoFrame v2 |
| `{{DEV_CMD}}` | `go run main.go` |
| `{{ARCH_LAYER}}` | 分层 api → controller → logic → dao/model（GoFrame 标准） |
| `{{DB_ACCESS}}` | GoFrame ORM + 内置迁移 |

### Go — LangChainGo（LLM）

| 参数 | 值 |
|------|-----|
| `{{LANGUAGE_DESC}}` | Go、LangChainGo、LLM 编排框架 |
| `{{FRAMEWORK_VER}}` | LangChainGo |
| `{{DEV_CMD}}` | `go run ./cmd/` |
| `{{ARCH_LAYER}}` | Chain → Model → Tool/Retriever，链式编排 |
| `{{DB_ACCESS}}` | 向量库 + 会话存储 |

### Go — Google ADK-Go（Agent）

| 参数 | 值 |
|------|-----|
| `{{LANGUAGE_DESC}}` | Go、Google ADK-Go、Agent 开发套件 |
| `{{FRAMEWORK_VER}}` | ADK-Go |
| `{{DEV_CMD}}` | `go run ./cmd/` |
| `{{ARCH_LAYER}}` | Agent → Tool → Model，工具化编排 |
| `{{DB_ACCESS}}` | 向量库 / 会话存储 |

### Go — cloudwego/eino（Agent）

| 参数 | 值 |
|------|-----|
| `{{LANGUAGE_DESC}}` | Go、cloudwego eino、LLM 编排框架 |
| `{{FRAMEWORK_VER}}` | eino |
| `{{DEV_CMD}}` | `go run ./cmd/` |
| `{{ARCH_LAYER}}` | Graph 节点 → 边，Agent 编排 |
| `{{DB_ACCESS}}` | 向量库 / 会话存储 |

### Go — tRPC-Agent-Go（Agent）

| 参数 | 值 |
|------|-----|
| `{{LANGUAGE_DESC}}` | Go、tRPC-Agent-Go、Agent 框架 |
| `{{FRAMEWORK_VER}}` | tRPC-Agent-Go |
| `{{DEV_CMD}}` | `go run ./cmd/` |
| `{{ARCH_LAYER}}` | Agent → Tool → Model，tRPC 服务化 |
| `{{DB_ACCESS}}` | 向量库 / 会话存储 |

### Go — Firebase Genkit

| 参数 | 值 |
|------|-----|
| `{{LANGUAGE_DESC}}` | Go、Firebase Genkit、AI 后端工具链 |
| `{{FRAMEWORK_VER}}` | Genkit Go 版 |
| `{{DEV_CMD}}` | `go run ./cmd/` |
| `{{ARCH_LAYER}}` | Flow → Tool → LLM，Flow 编排 AI 逻辑 |
| `{{DB_ACCESS}}` | 向量库 / 会话存储 |

### Go — Anyi（LLM Agent）

| 参数 | 值 |
|------|-----|
| `{{LANGUAGE_DESC}}` | Go、Anyi、LLM Agent 框架 |
| `{{FRAMEWORK_VER}}` | Anyi |
| `{{DEV_CMD}}` | `go run ./cmd/` |
| `{{ARCH_LAYER}}` | Agent → Tool → LLM，工具化编排 |
| `{{DB_ACCESS}}` | 向量库 / 会话存储 |

---

## 约束

- ❌ 禁止修改已存在的 `.harness/` 内容（除非用户明确要求覆盖）
- ❌ 禁止在检测到多语言时擅自选择
- ❌ 禁止跳过 Step 1 直接使用默认语言
- ✅ 如果 `.harness/` 已存在，输出提示并询问是否覆盖
- ✅ 每个步骤完成后输出简要状态
