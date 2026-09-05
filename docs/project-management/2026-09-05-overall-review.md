# ARC.ONE 整体复核（2026-09-05）

## 结论

ARC.ONE 已具备范围较完整、能够自动化验证核心闭环的 V1.0 Lite 原型基础。
优势是 Workflow/Agent 的版本化、运行持久化、Human Review、独立 Evaluation、Workspace 授权和审计
已在同一产品中连接起来。当前证据不足以支持“企业生产就绪”或“Netlify 后端迁移已完成”的判断。

建议继续推进用户已选择的 Netlify 全量迁移目标，但在 Issue 04 实现前插入一次工程门禁与身份
约束修复。不要把 Python 实现的既有缺陷当作必须复制的兼容契约，也不要把迁移视为简单托管切换。

本轮是审查：没有修改业务代码、切换生产流量或发布修复。以下建议未实施。

## 本轮依据与边界

- 本地基线：`98fe888af08df05829f80f552d26ea979aa68495`，分支 `codex/harness-governance`。
- 实时 Netlify 项目查询：Production deploy `6a9a97898a5f2300089163e3`，状态 ready。
- 读取领域语言、项目流程、项目总览、实现记录、迁移 PRD/Issue、CI、前端入口、主要业务模块及身份迁移代码。
- 新运行的前端全量测试：52 文件、313 项通过；lint、TypeScript/Netlify typecheck 与 build 通过。
- 新运行的 Python 身份、成员、V1 Lite 端到端测试：55 项通过。本轮没有重跑历史 407 项后端全量。
- Python 测试禁用 `.env` 读取、使用隔离数据库；默认临时目录出现 Windows 权限错误后，指定全新项目临时目录复跑通过。
- 生产 `/login`、Netlify `/api/health`、Zeabur `/api/health` 返回 200；休眠身份 Function 直连返回 404。
  这些只验证公开入口状态，不代表本轮提交了真实账号登录、模型调用或业务验收。
- 本轮没有 PostgreSQL 并发压测、灾难恢复演练、依赖漏洞审计或全面安全扫描。
- 既有 `.harness/wiki/research/` 保持未触碰。

## 值得保留的基础

1. **领域方向明确。** Workflow Version、Artifact、Human Task、Review Qualification 与 Audit Event
   各有明确语义，适合需要审核、追溯和治理的企业流程。
2. **核心闭环有实现和测试。** 自动端到端测试覆盖种子资产、运行、人工审核、评估、回归与 Trace；
   ModelGateway/AgentRuntime 等测试接缝可以隔离真实模型费用与不确定性。
3. **已有服务端保护。** Workspace 隔离、稳定版本引用、Secret Ref、受限网络出口、Session/CSRF
   已进入代码和回归测试，并非只依赖前端按钮显隐。
4. **迁移的生产边界保留得当。** schema/Function 先部署，业务流量继续经 Zeabur；避免新数据库尚未
   导入真实身份时切走登录。继续保留这一边界。

## 需要优先处理的发现

### 1. P1：全局停用 User 会漏检其他 Workspace 的最后管理员（已复现）

Python `apps/api/app/routers/workspaces.py:906` 的 `disable_user` 只检查 URL 中当前 Workspace
的成员角色和管理员人数，却把 User 全局标记为 disabled。TypeScript
`netlify/functions/_shared/identity-workspace/postgres.ts:1117` 采用同样范围的检查。

本地全合成数据库复现：

- 用户 U 在 A 是 builder，在 B 是唯一 active、非组织管理员的 workspace_admin。
- 组织管理员通过 A 的 `/members/U/user/disable` 停用 U。
- API 返回 200；B 的有效 Workspace 管理员人数变为 0。

这违反项目已声明的“至少保留一名有效 Workspace 管理员”规则。组织管理员仍可介入恢复，
因此不等同于整个组织永久锁死，但普通 Workspace 的治理约束确实失效。

修复应覆盖 U 所属的所有受影响 Workspace，并在事务中保护这一不变量。新旧实现都需要测试；
只验证当前 Workspace 的最后管理员不足以防止这个场景。

本地诊断脚本：`.scratch/overall-review-20260905/reproduce-admin-invariant.py`。它禁用 `.env`，
仅创建合成 SQLite 数据库，不操作生产账号。

### 2. P1：Netlify 发布分支没有自动触发当前完整 CI（配置及远端记录已核对）

`.github/workflows/ci.yml:3` 只监听 `master/main` 的 push 和目标为这两个分支的 PR。
Netlify 当前生产分支是 `codex/harness-governance`，`netlify.toml:2` 的构建命令只有
`npm run build`；它包含类型检查，但不包含完整测试和 lint。

GitHub 该分支的运行查询能看到历史 CI，最新返回的两个 SHA 为 `14af42b` 和 `a40763d`，
没有当前身份迁移提交的对应运行。因此不能把本地通过测试等同于受远端 CI 约束的自动发布。

先统一实际发布分支与 CI 触发范围，再决定采用“通过 CI 后才发布”还是明确受控的手动发布流程。
仅增加 CI 触发也不自动保证 Netlify 会等待 CI；门禁与发布时序都要验证。

### 3. P1：新身份服务缺少旧服务的通用请求保护，契约验证尚不充分

旧 API 在 `apps/api/app/main.py:6610` 注册通用限流和请求体大小检查。新身份 handler
在 `netlify/functions/_shared/identity-workspace/handler.ts:119` 直接读取完整请求体；
持久限流仅用于邀请接口，登录只保留按已存在账号计算的错误锁定。

离线边界诊断中，同一个超过 1 MiB 的 JSON 登录请求：旧 API 返回 413；新 handler 把请求传入
注入的模拟 backend 并返回 200。这证明应用层入口保护不等价，**不意味着已在公网突破 Netlify
平台限制**。对于未知邮箱登录，账号锁定不能代替客户端维度的总请求限流。

另一个已复现边界：新 handler 收到无关 Cookie `unrelated=%` 时，`decodeURIComponent` 抛错，
最终返回 503；一个无关的畸形 Cookie 不应被当作服务不可用。

诊断脚本：`.scratch/overall-review-20260905/reproduce-handler-boundary.mjs`，无外部网络请求。

仓库保留的 17 项身份专项测试主要验证安全原语、路由、HTTP 包装和模拟 SQL 返回。
没有可重复执行的 PostgreSQL 集成/并发测试，也没有迁移 PRD 承诺的 Python/TypeScript 双实现
契约对比入口。历史 47 项 Preview 检查是有价值的演练，但其临时脚本已删除，无法直接成为后续
每次变更的回归门禁。应保留参数化、使用合成数据的验证工具，不必保留公开固定账号或 seed。

### 4. P1（扩并发或迁移执行前）：队列租约还不能作为可靠并发执行的证明

`apps/api/app/execution.py:623` 先普通 SELECT 找 queued/租约到期的任务，再更新 running 并提交。
该领取路径未使用行锁或带原状态条件的原子更新。两个消费者可能同时读到同一条任务；这是静态
代码确认的竞态条件，本轮未做数据库并发复现。

默认租约 300 秒。`apps/api/app/worker.py:38` 在同一线程同步执行完整任务；代码检索只发现 HTTP
接口调用续租方法，没有 Worker 执行期间的自动续租调用。超过租约的仍在运行任务存在被其他
消费者接管的风险。只有单 Worker 时发生条件不同，不应据此声称线上已经重复执行。

迁移到 Async Workloads 前，需要验证原子领取、重复投递、超时接管、自动续租或可恢复步骤、
旧执行者失去租约后的写入保护，以及模型/外部工具的副作用边界。当前探针完成和重试成功只能
证明平台通路，不能证明业务执行恰好一次。

### 5. P2：产品页面存在“看起来已经真实运营”的误导风险

- `src/pages/Dashboard.tsx:14` 仍导入 mock 数据，且页面直接写“今日运行态势”“86 次工作流运行”
  “本月节省工时”等文案。文档声明演示数据不能替代页面内清晰标注。
- `apps/api/app/agent_runtime.py:31` 的 `quality_score` 根据输出长度给 0/50/100；
  `src/pages/Runs.tsx:593` 等位置将分数称为质量得分。这一基础启发式不代表业务质量。
- 项目另有真正的独立 Evaluation/Rubric/模型评估实现。应区分基础输出检查分与评估分，避免把
  前者误解为后者；本发现不表示所有 Evaluation 都是长度评分。

建议先使页面指标来源和评分含义准确，再用一条真实业务流程验证是否节省时间、减少返工。

## 架构和工程可维护性

规模热点（物理行数，包含空行）：`main.py` 6,700 行，`QualityOperations.tsx` 3,223 行，
`Workflows.tsx` 2,423 行，新身份 `postgres.ts` 1,225 行。

行数本身不是缺陷，但新身份文件已经同时承担事务、认证、授权、输入验证、序列化、审计和成员
操作，与 PRD 的薄路由/应用服务/Repository 分层目标有差距。建议在补测试后按实际责任拆分，
以“能独立测试规则、统一事务边界”为目的，避免为了分层制造大量只转发调用的小文件。

`src/App.tsx:8` 起静态导入全部主要页面。本轮构建主 JS 为 755.28 kB（gzip 215.42 kB），
保留 chunk-size 提示。按路由懒加载是有依据的优化候选，但其优先级低于身份约束和发布门禁。

关系数据库模型有逻辑引用但无物理 ForeignKey；baseline 复制了这一事实。
迁移对账必须保留孤儿记录和跨 Workspace 引用检查，不能只比较表数量。

## 项目管理与迁移判断

项目总览顶部仍标 2026-07-18、master/Zeabur 基线，后面追加 2026-09-04 Netlify 记录，
“下一步身份切片”也与后文“身份切片完成”并存。当前事实入口需要改成一个明确的最新快照，
历史证据下移；迁移状态应区分实现、隔离验证、生产部署、生产切流和业务签收。

Issue 03 可以被描述为“实现并在 Production 休眠部署，完成一次隔离演练”；根据本轮发现，
不应据此认定身份领域已完成所有安全约束与可重复契约验证。

Issue 04 当前只有三条宽泛验收标准，却包含 Agent、Workflow、Data Object、Tool/Skill、Model
Provider、Rubric、Golden Sample 七个领域，状态仍为 needs-triage。这个粒度不适合直接整项重写。

迁移不是 3/8 Issue 完成就意味着完成了 37.5% 工作：运行引擎、人工暂停恢复、评估、通知、
调度和真实数据切换仍是主要难点。两个语言后端并存期间还要管理行为漂移。

## 建议的下一步顺序

1. **先修交付门禁与身份约束。** 统一发布/CI，补跨 Workspace 用户停用保护、通用请求保护、
   最小 PostgreSQL 集成测试及新旧契约对比工具。用失败测试证明缺陷，再修复。
2. **收敛项目事实与页面表达。** 更新当前快照、真实/演示指标标签和评分含义，保留未完成的
   业务签收与恢复演练事项，不用技术测试替代签收。
3. **拆细 Issue 04。** 先锁定 Provider/Tool 引用的最小依赖，再做 Agent 草稿→发布版本→刷新
   读取；随后做 Workflow 草稿→版本引用→发布。按依赖分批迁移其余治理资产，各批都有持久化、
   授权、审计与契约测试。
4. **执行迁移前先验证难点。** 用全合成业务任务验证重复投递、暂停恢复、取消、长任务与外部
   副作用；结果决定 Issue 05 的细化方案，不因平台探针成功就默认运行引擎可直接搬迁。
5. **最后完成真实业务与数据切换。** 保留单主写、备份、最终增量、对账、带数据边界的回滚与
   观察期；这些完成后再下线 Zeabur。

本轮建议不要求推翻现有项目或重做 UI。下一批最值得投入的工作是把已经具备的能力变得可信、
可复现和可持续迁移。
