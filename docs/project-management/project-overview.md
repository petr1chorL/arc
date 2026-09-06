# ARC.ONE 当前项目状态

> 事实快照：2026-09-06（CI 修复已通过云端门禁并发布；原生迁移准备继续，生产未切流）
> 当前产品迭代：V1.0 Lite（`in-progress`）
> 当前安全切片：P0 运行时安全收口（`ready-for-human`）
> 当前可靠性切片：生产启动可用性恢复（`ready-for-human`）
> 当前集成切片：远程 Agent API（`ready-for-human`）
> 当前功能切片：04A–04E、05/06 本地工程验证通过（ready-for-human）；生产数据迁移未执行
> 迁移生产分支：`codex/harness-governance`；已推送并发布 `b626602`；后续准备代码的发布状态见切流回执
> 最新已验证代码：`68f9f6b` 已推送，CI `34027123972` 全步骤成功；Netlify同提交因credit超限跳过，未上线
> 线上边界：Netlify 前端 + Zeabur API/Worker/业务数据；不得关闭 Zeabur

本文是项目级唯一当前事实入口，用于回答“项目是什么、已经做到哪、明确没做到什么、
现在应该做什么”。发生冲突时，按以下优先级判断：

```text
当前源码与本轮验证
> 本文
> 具体 Acceptance / PRD / Issue
> docs/CURRENT_IMPLEMENTATION.md 的历史实现记录
> 路线图与长期蓝图
```

## 项目定位

ARC.ONE 是面向企业的 Agentic Workflow 操作系统，用于管理 Agent 资产、工作流编排、
结构化产出物、质量评估、人工审核、运行观测与持续优化。

当前形态不是单纯的拖拽页面，也不是企业生产平台，而是已经具备真实 API、持久化和
模型调用边界的 V1.0 Lite 可运行原型。目标是先让一个真实业务团队独立跑通一条闭环，
再决定下一阶段生产化或外部集成方向。

## 当前可运行基线

### 07/08 生产迁移推进（2026-09-06）

最新：观测页状态振荡/详情迟到及资产验证库迁移依赖已修复，代码68f9f6b的CI34027123972
全步骤成功；两项Spec/Standards独立轴各0阻断。补充审查/状态文档不改变该代码验证对象。
同提交Netlify部署6a9d3e51d5c02b00086acbdc仍因credit usage exceeded跳过；线上仍b626602。
目标production数据库只读迁移状态为7条已应用、Tool快照1条待应用，未执行迁移、未核实源数据。
费用授权未答复，未充值/升级；生产备份/恢复/任务对账、公开宿主接线、真实业务验收、切流回滚、
稳定观察与Zeabur退役仍未完成。精确证据见切流目录verify.md最新段；下方为过程记录。

用户已授权完成上线数据迁移与稳定观察后关闭 Zeabur。04A–06 基线 `a4894b3` 的 CI
`34013885627` 因 Workflow 旧页面 effect 继续扇出版本请求触发 429 而失败。
修复提交 `b62660223dad8b43a725bd9bf847959ac511b2a8` 已推送，GitHub CI `34020649346`
全部通过。Netlify 正式部署 `6a9d1d993c53f700086e848e` 为 ready/current，精确提交匹配，
发布时间 2026-09-06T08:14:23.375Z。没有降低限流、切换 `/api` 代理或启动原生 Worker。

后续本地准备已完成全域纯路由、默认关闭门禁、显式模型依赖工厂，以及 Provider 配置检查/编辑面迁移。
旧 Worker 手工领取明确 410；运行删除仅安全拒绝 409，不表示成功删除能力已迁移。
源库只读盘点工具已完成合成验证；准备提交 4c65b48 已推送，其 CI 34021720282
因 Node 测试被前端 Vitest 误收集失败。最小配置修正与防漏跑回归已经本地验证：69文件/681项、
lint/build/deploy:check通过；独立审查无漏跑。修复提交1940c36的CI34022125444全部成功；
内部API宿主接线提交2f51d8e的CI34023212681也全部成功。Netlify接口仍确认当前发布为b626602。
HTTP Tool 独立异步测试本地实现与双轴复审通过，22运行程序和7浏览器场景通过；同页重试幂等与
空输出不误报成功已修复，Tool提交0a35e929已推送。后续观测页导航振荡与旧详情覆盖已确定RED→GREEN；
71前端文件696项完整8分片连续通过、7浏览器场景与lint/build通过，独立复审0阻断。
这是两条已证实缺陷修复，不声称所有历史卡死均为同一原因，见切流目录observability-navigation-verify.md。
最新Netlify API证实Git关联有效、后续四次push已触发，但因账户credit usage exceeded全部跳过。
当前仍发布b626602；未购买额度，不能把新本地代码或GitHub推送当成已上线。
随后52e36f8的CI前端/Python/身份PG通过，但资产PG因旧测试库缺runtime表失败；
已修复测试设施迁移加载，原合同198检查/52角色路由/26共享请求、22原生程序、9浏览器场景通过。
精确边界见切流目录asset-fixture-migrations-verify.md，不把该CI总体标记成功。
真正公开宿主/AWL/通知适配、成功Run删除与隔离云端验收尚未完成。

切流审查发现五条旧路由兼容缺口、生产全域入口/网关/AWL 装配缺口，以及旧非终态运行
缺少原生 Operation/checkpoint 的迁移边界。不能将旧业务表复制成功等同于运行任务可继续执行。
生产备份、恢复验证、数据对账、真实业务验收、单主切流、回滚演练、稳定观察和 Zeabur 退役
均未完成。用户随后已登录 Chrome；代理已通过新标签页恢复浏览器操作，确认服务为
`postgresql`、`arc-web`、`arc-api-live`、`arc-v1-lite`。PostgreSQL 18 运行中，其控制台
备份功能要求升级方案；`arc-v1-lite` 运行中且没有挂载硬盘。实际数据库连接与导出路径
尚未核定。免费命令终端反复 Connection lost/Reconnecting，未取得 SQL 执行结果。
已单独请求是否批准首月最多 5 美元 Dev 费用，未收到答复、未购买方案。
Zeabur 报告 `victoria-metrics` 系统组件异常，未执行服务器更新或重启；
未读取生产凭证或为获得空队列取消真实任务。设计、计划和回执见
`../../.harness/changes/netlify-production-cutover/`。

### 05/06 最新推进（2026-09-06，本地实现与验证）

用户已确认长操作 `202 + Operation`，以及外部结果不确定时暂停自动重放、显式核对的策略。
本地已实现固定版本 Workflow/Agent 执行、节点检查点、租约代次、取消/死信/重投、通知及调度，
并贯通人工认领/转交/会签/修改/恢复、实际评分响应解析、逐样本回归、整改复测、产出物版本与追踪。
Operation 与关联 Run 的失败状态同事务保存；取消运行阻止子恢复任务产生新调用意图。
根验证入口 `node scripts/verify-runtime-local.mjs` 的 12 个程序已通过；浏览器 5 条真实 HTTP/PG
闭环通过，外部模型与通知 transport 为受控合成适配器。最终两轴审查及完整门禁回执见
`../../.harness/changes/netlify-runtime-closure/`。两轴严重问题 0；最终前端 68 文件 677 项、
lint/build/deploy:check 通过，本地工程 ready-for-human。两次测试进程间歇占用后诊断重放全过，
未确认工具链异常根因，不把重新通过描述为根治。

新公开 Function 为硬休眠（404、无事件订阅、无 schedule）；AWL consumer 和定时派发仅完成
可注入接缝与本地实现，尚未云端启用/验收。生产路由仍代理 Zeabur；基线现已提交/推送，云端验收状态以上方 07/08 记录为准。
本轮范围是截图 3、4 的本地工程交付，不是 5、6 的真实备份迁移、切流、稳定观察或关闭 Zeabur。
边界：整改复测仍为原产出物重新评分；Skill/Python Package 仍为元数据，不是任意代码执行；
取消后的既有人审记录保留，可能仍显示待审但提交被拒绝；不能据此宣称完整生产业务验收。

### 最新本地收尾（2026-09-06，优先于下方历史逐轮数字）

04B/04D 已完成最终双轴审查：修复 Agent/量规异步串数据、候选确认被旧列表覆盖、
资格撤销与确认死锁，补休眠候选 Function 与页面样式。主线程最新前端61文件605项、
浏览器8条（29.7秒）、身份PG129、资产PG198、AgentPG232、Data ObjectPG62、量规PG161、
候选PG139通过；另8条实际资格管理HTTP竞争通过。lint/build/typecheck/deploy:check通过。
Python591项是04B/04D当时的全量证据，不是后续04E修改后的全量。
完整回执与两轴独立结论见 `.harness/changes/netlify-agent-lifecycle/` 和
`.harness/changes/netlify-rubric-sample-governance/`。旧worker间歇卡顿根因仍未查明。

04E已按用户确认范围完成八条工作流治理路由和两个审核只读目录的Python/TS迁移实现。
草稿CRUD、图/映射、Agent/Data Object/Rubric固定版本、同空间人审校验、原子发布、不可变历史和软删除均通过。
补齐页面目录加载/错误/重试、跨路由异步隔离、保存后真实ID刷新、发布失败出口及历史失败只读重试；运行入口双重阻断。
最终前端62文件656项、同库浏览器9条（35.2秒）、Workflow PG202项/56组共享HTTP、6组真实锁竞争/44检查通过。
Python全量基线629项（766.25秒）通过，最后新增的既存嵌入快照历史保护另有7项定向回归，不混称最后代码一次全量。
身份129/资产198/Agent232/DataObject62/量规161/候选139本轮重新通过，Python Workflow PG及lint/build/typecheck/deploy:check通过。
两轴复审无剩余已证实严重项，04E进入ready-for-human；回执见 `../../.harness/changes/netlify-workflow-lifecycle/verify.md` 和 `review.md`。
CI已注册这些验证但未运行远程CI；此前并行前端出现一次Observability超时，按既有串行文件策略最终656通过，未宣称间歇问题根因已修。
设计见 `../superpowers/specs/2026-09-05-netlify-workflow-lifecycle-design.md`；当前接续是执行/异步/通知/定时迁移，而非关闭Zeabur。
以上改动尚未提交/推送/部署；下方04B待审/04D编码等段落是历史过程，不覆盖本段最新状态。

- 前端：React 19、TypeScript、Vite、React Router、React Flow。
- 后端：FastAPI、Pydantic、SQLAlchemy。
- 数据：本地默认 SQLite，部署可使用 PostgreSQL。
- AI：OpenAI-compatible ModelGateway；自动化测试使用 FakeGateway。
- 当前入口：`https://arc-one-agentic-os.netlify.app/`，`/api/*` 代理 Zeabur。
- 旧完整服务：`https://arc-v1-lite-lindabaoz.zeabur.app/`，仍承载生产 API、Worker 与业务数据。
- Netlify 已有空业务 schema 和休眠身份 Function；不代表生产身份或业务数据已经迁移。

2026-09-05 整体复核见 `2026-09-05-overall-review.md`：确认跨 Workspace User 停用的
最后管理员保护缺陷、迁移分支 CI 缺口与请求防护/可重复契约验证缺口，优先修复后再继续资产迁移。
资产迁移按 `netlify-asset-migration-slices.md` 拆为 04A–04E。下面日期段落保留历史演练证据，
其“下一步”仅代表当时顺序，不覆盖本节的当前优先级。

04A 设计与实施计划已确认：13 条资产接口、配置允许结构、历史摘要隐藏与作用域检查已实现。
休眠 `reference-assets.mts` 不配置公共路径；生产 `/api/*`、环境变量和数据库未变。
两页在显式迁移模式下提供登记、编辑、停用、真实影响面与审计，禁用尚未迁移的执行入口；
默认模式不变，不把登记成功解释为模型、HTTP 或 MCP 已可执行。

最新本地证据：前端/脚本 55 文件 400 项；资产 PostgreSQL 198 项（含 26 个 Python/TS
共享请求与 52 个角色/路由检查）；身份 PostgreSQL 129 项；浏览器 3 条同库路径通过。
浏览器独立连接确认本轮随机 schema 已清理。历史审计非法状态/目标、非对象 metadata、损坏版本
快照与显式 null 原因已有拒绝测试；排序、截断、最近 200 条窗口及未知事件隐藏已验证。
最新后端安全聚焦 31 项、全量后端 481 项通过；04A 本地工程已完成验证，Issue 为 ready-for-human。
lint 已修正本轮测试清理代码警告，构建/类型与部署配置静态检查通过。
CI 定义包含资产 PG 和隔离浏览器步骤，但本轮未推送、未运行远程 CI、未部署。

04B 八条治理路由已盘点；合成重放确认乱码状态、11 个非法 null 异常、合法 Provider 解绑和
远程 URL 结构差异。用户已确认 `../superpowers/specs/2026-09-05-netlify-agent-lifecycle-design.md`。
Python 新写入状态、非法 null、URL/manifest 与历史引用归属保护已 RED/GREEN 实施，相关 98 项测试通过；
合法 Provider 解绑保持，同空间已停用资产不阻断历史读取。TS 路由与请求防护已加入，
Agent/资产 HTTP 测试 54 项通过。Agent TS 八条治理操作已具备本地 PG 实现，220 项检查通过，
13 个创建请求和 11 个生命周期后续请求与 Python 完整响应匹配；两个独立 Session 并发发布、
版本冲突与审计失败回滚通过。四角色/八路由矩阵、三类依赖 SQL 停用竞争和休眠入口验证通过；
Agent 页面迁移模式已加入依赖错误显式提示、运行按钮/事件双重阻断与历史状态计数修正，
相关四页 34 项测试通过；同库浏览器四条路径通过并已确认本轮合成 schema 清理。
全量前端 56 文件 436 项、身份 PG 129、资产 PG 198 及 lint/build/deploy:check 通过；
全量后端 536 项通过；实时 Agent 引用额外字段投影差异已修复并重跑 PG/前端/浏览器。
历史引用缺失字段/异常类型保护已同步修复，相关 Python 104 项和浏览器四条通过。
修复后后端全量 542 项通过（434.08 秒）。前端首轮 worker 持续无输出，核实并终止专用 worker 后，
详细报告重跑 56 文件 436 项通过（53.37 秒）；首次异常原因尚未确定，不因重跑成功宣称根因已修复。
04B 最终审查未完成，未发布。
04B 新证据见 `../../.harness/changes/netlify-agent-lifecycle/verify.md`，不能沿用 04A 全量数字宣称本轮全量通过。
04C 用户确认五接口设计后，Python 新增只读历史版本列表；空历史、发布后修改草稿、两版快照、
跨空间/未登录和损坏历史不改写的相关 11 项通过。lint/build/deploy:check 通过。
随后 TS 五路由、请求校验、PG 事务及休眠入口已实现首轮：38 项路由/边界测试、61 项合成 PG 检查
（含四角色五路由、两 Session 并发、名称竞争及三写操作审计回滚）通过；Python 固定错误已 RED/GREEN，相关 13 项通过。
随后后端全量 549 项通过；12创建+11后续实际请求的 Python/TS 完整响应对比通过，PG 共62检查。
迁移模式已补此前缺失的 Data Object 应用路由/导航和只读历史入口；同库浏览器五条路径通过，
刷新后分别读取两版 Schema。页面错误重试及“发布成功但刷新失败”提示已验证，相关五页39项通过。
最新页面改动后的前端全量57文件476项通过。Python 已补候选版本冲突、写入行锁、异常草稿固定错误、
已知名称唯一约束映射，相关23项含四角色五路由通过；PG62项/共享请求复跑通过。
Python实际PG发布锁阻塞已通过独立连接观察；新后端全量559项通过，两轴独立审查未发现已证实严重问题。
04C本地工程进入ready-for-human，限制与证据见`../../.harness/changes/netlify-data-object-lifecycle/review.md`。
本机PG脚本使用系统Python3.14驱动及项目纯Python后备依赖，CI3.12已配置但远程未运行；不宣称生产迁移完成。
全部 9 项范围见 `netlify-migration-execution.md`；04B–04E、运行闭环、真实数据切换和
Zeabur 退役仍未完成。详细命令、RED/GREEN 和边界见
`../../.harness/changes/netlify-reference-assets/verify.md`。旧逐步记录保留在回执，不覆盖本节事实。

04D设计已获用户接受。Python已补固定字段错误、候选来源损坏拒绝、确认来源隔离、资格共享锁、
候选行锁、已知样本唯一约束409，以及修改版本/运行/人工任务来源共享锁；相关四文件59项通过。
真实PG脚本观察同候选阻塞、资格撤销、跨候选唯一键冲突及三类来源同值UPDATE阻塞，并独立核实样本和审计。
TS已实现量规六条治理路由及默认初始化；PG161项、8个创建/17个后续实际Python HTTP完整响应对比通过，
另63个schema级共享请求通过。已实际观察初始化、发布及Provider停用锁等待，三种生命周期写入审计失败回滚通过。
休眠rubrics.mts不配置生产path。Python量规初始化/生命周期锁、Provider共享锁、损坏历史固定409及版本冲突拒绝已补齐；
相关32项与实际PG锁验证通过，最新后端全量589项通过（630.99秒）。
候选三路由解析、确认字段校验及HTTP防护已有29项测试，与量规85项合计114项通过；lint/build通过。
候选TS三操作已接身份事务：确认采用资格共享锁、候选行锁及来源共享锁，样本/状态/human-task审计同事务。
本机PG139项通过，含候选三路由12个实际Python/TS完整HTTP响应对比，以及同候选锁、跨候选唯一键和依赖SQL竞争。
Python已补历史样本Workspace重放拒绝并修正三条乱码提示；最新后端全量591项通过（613秒）。
完整资格管理HTTP竞争和迁移页面尚未验收；三类来源竞争为同值SQL更新，不等同运行生成链已迁移。
显式rubric-samples模式已新增独立候选面板，只调用候选列表/详情/确认；原Reviews默认模式不变。
页面与默认Reviews相关21项通过，lint/build通过；幂等重试、来源展示、成功后刷新失败有测试。
量规页已有迁移范围提示和依赖失败写入阻断；量规/候选已接本机隔离服务，未知API仍501。
八条同库浏览器路径通过：量规两版不可变历史与停用刷新、候选专家确认/非专家403及刷新状态、此前五条资产回归。
量规发布成功/历史刷新失败已分离提示与只读重试，防止误触重复发布；最新完整前端61文件595项通过（20.45秒）。
完整资格管理HTTP竞争、页面其余失败/异步边界及最终审查仍未收口；不能据本地合成测试宣布生产迁移完成。
没有新增生产path或切换业务流量；04D不能标为完成。详细边界见`../../.harness/changes/netlify-rubric-sample-governance/verify.md`。
本轮后端全量583项通过（488.61秒），包含已接受的Agent数值规则及量规固定错误契约。
前端首轮全量出现持续占用CPU的worker异常并定点停止；详细报告重跑58文件497项通过（18.06秒）。
首轮异常根因未查明，不据重跑通过声称已修复。lint/build通过；本轮没有生产操作。
量规TS存储首切片后的最终前端验证：八分片合计58文件560项均通过；其中第三片首次异常，单文件及分片详细重放后通过。
全量/分片仍有间歇worker持续CPU与内存增长的未决风险，未据重跑成功声称解决。PG26项及字段共享请求63项通过。

加固代码 `ba35010` 已在独立分支 `codex/identity-release-hardening` 完成工程验证：
前端 333、后端 410 项，以及真实 PostgreSQL 129 项检查通过；GitHub CI run 33928026353
成功，最小新旧身份契约对比与并发管理员保护通过。随后 cc98029 在 PR #39 的 Netlify
Deploy Preview `6a9b54d034fa00000853068e` 完成验收：精确 SHA 的 push CI 33929272335
与 PR CI 33929817681 均成功，云端门禁日志确认放行同一 SHA；登录页/资源、未认证 API
边界和 Preview 数据库健康通过，身份 Function 继续休眠。未提交真实登录或业务写入。
随后经用户单独授权，PR #39 在 ebe2553 的 push/PR CI 均成功后合并为 b56b991。
合并提交 CI 33931945737 success；Production Deploy `6a9b5d59a62aa90007f4be38` 已发布且为 current，
云端门禁确认同一完整 SHA，无新增 migration。生产登录页/静态资源、API 只读健康、未认证 401、
休眠 Function JSON 404 和数据库健康均通过；浏览器 DOM 正常，截图/控制台采集超时，未执行真实登录。
Zeabur 生产 API 未更新，生产身份数据与流量仍未迁移。
回执见 `.harness/changes/identity-release-hardening/verify.md`。

2026-09-04 已通过 Netlify 原生迁移的平台门禁：站点 `arc-one-agentic-os` 的生产数据库分支、
非业务探针 migration、数据库健康 Function 与 Async Workload 已完成线上验证；临时 PR #36 进一步
证明 Deploy Preview 数据库包含独立标记而 Production 不包含，删除 Preview 后 Netlify 与 Zeabur
生产健康链路仍可用。当前 130 个业务 API、43 张业务表、Execution Worker、Notification Worker
和生产数据均尚未迁移；Netlify 的 `/api/*` 仍代理 Zeabur，因此该门禁站点不是独立生产替代品，
现阶段不得关闭 Zeabur。

2026-09-04 随后的 schema 与非生产数据演练已完成：当前 SQLAlchemy metadata 被固化为
`20260904060000_create-arc-one-baseline`，覆盖 43 表、524 列、112 索引、26 个唯一约束，
并如实保留当前模型 0 个物理 ForeignKey 的事实。PR #37 的隔离 Preview 数据库以固定全合成
快照完成表存在性、行数、主键摘要、逻辑引用、状态分布和数值汇总对账；Preview 专用 seed、
状态 Function 与纠错 migration 未合入生产。Netlify Production Deploy
`6a9a53c1b2196e00085ab758` 已应用永久 baseline，但仍没有生产业务数据或业务 API；
`/api/*` 继续代理 Zeabur，下一步是身份与 Workspace 最小切片。

2026-09-04 身份与 Workspace 最小切片已在 PR #38 的隔离 Deploy Preview
`6a9a5a769f551e000987bcf5` 完成验证：TypeScript Function 覆盖 Auth、Session/CSRF、Invitation、
Workspace、Membership、RBAC、Reviewer 与 Audit；47 项真实 API 检查及浏览器登录进入
`/w/arc-one-preview` 均通过。演练只使用 `.invalid` 合成身份和 Preview 数据库；生产候选已移除
合成 seed、Preview 冒烟脚本与身份路由，只保留休眠 Function、持久限流表、测试和文档。
Production Deploy `6a9a633965b65a0008212b8c` 已发布提交 `4f9544e`，应用
`20260904133000_create-identity-rate-limits`；直连身份 Function 返回 404，Netlify 与 Zeabur 健康
端点均返回 200。
因此该结果是迁移实现与隔离证据，不是生产账号、生产数据或流量已迁移；Production 的
`/api/*` 仍须代理 Zeabur，下一受控切片为 Agent/Workflow 资产与版本契约。

2026-07-15，`3bd30c9` 的静态页面与 `deployment.json` 曾出现，但 `/api/health`
持续返回 502；生产随后通过受控 workflow 回滚到 `fc59082` 并恢复 API 200。生产启动修复
经 PR #19 合并并部署为 `0e4634f`；评估中心简化随后经 PR #20 合并，当前 `master` 与 Zeabur
已进一步对齐到 `df1a0cd`，`deployment.json`、`/api/health` 和 `/healthz` 均通过实时核对。
工作流评估节点与轻量模板库已经上线，但兼容模板的最终生产人工闭环仍待完成。这次事故同时
证明静态 SHA 只能标识页面版本，不能代替 API 健康、登录或 Seed 状态证据。

## 能力地图

| 能力域 | 当前判断 | 已实现边界 |
|---|---|---|
| 身份与 Workspace | 已实现第一版 | 登录、Session、邀请、成员、固定 RBAC、Reviewer 绑定、Workspace 隔离与审计 |
| Agent 生命周期 | 已实现 | 草稿、编辑、发布不可变版本、停用、测试运行、Provider 与 Tool/Skill 绑定 |
| Workflow 生命周期 | 已实现 | DAG 编辑与校验、输入输出 Schema、字段映射、发布快照、运行与历史记录 |
| Workflow 调度 | 已实现第一版 | 固定已发布版本、五段 Cron、IANA 时区、固定 JSON 输入、暂停/恢复、立即触发、下一次运行与派发记录；漏过周期不补跑，重叠运行跳过 |
| Agent Runtime | 已实现基础闭环 | 平台内置模型调用与同步远程 Agent API、有限重试、Token/成本字段、脱敏错误、HTTP Tool 调用；历史 Python Package 只读且失败关闭 |
| 执行与队列 | 已实现第一版 | 同步/异步运行、Worker、租约/心跳、重试、死信、取消、重投和操作审计 |
| Human Review | 已实现 | 暂停、审核资格、认领/会签、通过/驳回、恢复、反馈候选与 Golden Sample |
| Evaluation | 已实现，线上人工验收中 | Rubric 不可变版本、Provider/模型绑定、工作流 Evaluation 节点、系统加权总分、逐维度理由、Evaluation Record；节点已上线，兼容模板的最终生产闭环待签收 |
| Data Object / Artifact | 已实现第一版 | Data Object 版本、Artifact 契约、Schema 状态、目录、详情和运行追溯 |
| Observability | 已实现查询与追溯 | Run/NodeRun、Trace/Span、执行事件、成本摘要、队列和审计联动；无实时推送 |
| Tool / Skill | 已实现治理骨架 | Workspace 资产、稳定引用、HTTP allowlist、调用日志；真实 MCP Client 未接入 |
| Model Provider | 已实现治理骨架 | Provider 资产、环境变量 Secret Ref、HTTPS/Host 白名单、影响面与审计 |
| Notification | 已实现治理与 Outbox | Outbox、Worker、失败重投、渠道资产和状态治理；外部渠道适配不完整 |
| 运营总览 | 演示数据 | `src/pages/Dashboard.tsx` 仍读取 `src/data/mock.ts` |

## 2026-07-15 生产启动事故

已确认的失效链不是评估业务 API 本身，而是部署启动边界：

- 旧 PostgreSQL 不会被现有 SQLite 兼容逻辑补齐 `rubrics.model_provider_id`。
- V1 Lite Seed 新增可用 Provider 前置条件，显式 Seed 因缺失配置应继续失败关闭。
- 根 Dockerfile 的 `&` 会后台化整条 Bootstrap/Seed/Uvicorn 链；后端失败后 Nginx 仍提供
  静态页面和固定 200 的 `/healthz`，从而产生“页面在线、API 502”的假健康。

当前热修复采用定向 PostgreSQL 幂等补列、仅对 Provider 不可用进行结构化 Seed 跳过、
由 PID 1 入口先确认 FastAPI 健康再开放 Nginx、在 API 退出时结束容器，以及让 `/healthz`
代理 FastAPI。该修复已通过 PR #19 合并，并继续包含在当前 `df1a0cd` 部署中；公网版本标记
与两个健康接口均已通过核对；一条定向补列不代表正式 PostgreSQL 迁移体系已经完成，真实登录与 Seed 状态
仍需保留独立人工签收证据。



## P0 运行时安全边界

2026-07-10 完成的 P0 安全切片已经：

- 禁止模型 Provider 保存内联 Key，只允许后端环境变量名形式的 Secret Ref。
- 在最终模型出口执行 HTTPS 与精确 Host 白名单校验。
- 已移除新的 Python Package 配置与发布入口；历史快照保持只读，在 API 进程内不会导入或执行。
- 远程 Agent API 强制 HTTPS，并按 `Workspace + 精确 Host + Secret Ref` 三元绑定外呼；
  同时限制响应大小与总时限，且不跟随重定向。
- 在 Workflow 校验和 Runtime 两层阻断跨 Workspace AgentVersion 引用。
- 清理历史非法 Secret Ref，且不在响应、日志或审计中回显原值。

安全与远程接入的工程证据分别位于 `docs/ACCEPTANCE_P0_RUNTIME_SECURITY.md` 和
`docs/ACCEPTANCE_REMOTE_AGENT_API.md`，当前仍等待人工审阅，并要求轮换任何曾在界面
或对话中暴露过的真实模型 Key。

## 明确未完成

- 真实业务方尚未按手册独立完成 V1.0 Lite 签收；现有记录是自动技术验收。
- Dashboard 仍是演示指标，不应作为真实经营数据引用。
- 不再提供 Python Package 新接入；历史 Package 快照没有执行器。远程 Agent API 首版仍缺少独立 Endpoint 资产、私网 DNS 出口代理、异步协议、远端协作式取消和真实业务验收。
- MCP 只有可注入测试骨架，未连接确定的真实 MCP Server。
- 外部通知渠道尚未形成全面、经过业务验收的真实投递能力。
- 没有正式 Secret Manager/Vault、密钥轮换 API 或通用网络出口代理。
- PostgreSQL 正式迁移体系、备份恢复演练、自动回滚和灾难恢复未完成。
- 没有生产级高可用、正式 SLO、完整实时日志/Trace 基础设施和性能压测结论。
- 当前仍是单体 API 与单页应用；`main.py`、QualityOperations 和 Workflows 页面仍是大型热点；
  主导航的 Evaluations 已收口为轻量模板库，但次级 QualityOperations 仍是大型页面热点。
- 调度中心尚不是 DolphinScheduler 的完整替代：没有跨工作流依赖、补数、业务日历、Worker 分组、资源配额、复杂告警、高可用调度器、分布式锁和性能压测结论。

## 2026-07-16 验证状态

| 检查 | 本轮结果 | 解释 |
|---|---|---|
| GitHub / Zeabur commit 对齐 | 通过 | 公网 `deployment.json` 与 `master` SHA 一致 |
| Zeabur 首页和健康接口 | 通过 | 首页与 `/api/health` 返回 200 |
| `npm run lint` | 通过 | 本轮新证据 |
| `npm run deploy:check` | 通过 | 部署契约检查通过 |
| 默认前端全量测试 | 43 文件 / 261 项通过 | `npm test -- --run`，17.17 秒 |
| Issue 02 聚焦回归 | 4 文件 / 49 项通过 | 模板库、质量运营、路由与 Artifact 整改深链通过 |
| 标准 `npm run build` | 通过 | TypeScript + Vite 正常生成 `dist`；主 JS 741.40 KB，保留大包警告 |
| Issue 02 浏览器视觉验证 | 1 项通过 | Playwright 隔离 API + 真实测试登录；模板页、次级质量运营和旧深链通过 |
| 后端验证 | 386 项全量基线 + 87 项最终变更路径回归 | 全量 303.4 秒；最终 Gateway 23、Runtime 13、Execution 51；仅保留依赖弃用警告 |
| Playwright E2E | 2 项通过 | 隔离 SQLite、非生产测试管理员、真实登录；16.2 秒 |
| 远程 Agent 浏览器验收 | 通过 | 创建、配置、保存并发布远程 Agent；页面无 Package 入口，console 无错误或警告 |

本轮工程验证已经恢复并同轮通过，但这只清除了“无法重复验证”的工程阻断，不等于
P0 安全人工签收或 V1.0 Lite 业务签收已经完成。

2026-07-18 调度中心相关工程验证已通过：后端调度、队列、迁移、Workspace 隔离与生产启动路径 42 项测试通过；前端页面、路由和侧栏 15 项测试通过；`npm run lint` 与 `npm run build` 通过。该证据证明实现可发布，不替代合并后的生产页面、健康接口和真实定时触发验收。



## 当前优先级（2026-09-06）

1. 04A–04E、05/06 本地工程已验收，报告与 Issue 已同步；不要重复从契约盘点阶段开始。
2. 下一阶段按精确提交开展云端构建、原生入口装配与 AWL 云端耐故障验证；当前未执行生产发布。
3. 切换前完成生产备份/恢复、冻结与增量边界、数据对账、回滚演练及真实业务闭环。
4. 保持 Zeabur 现有链路；新平台不再依赖旧平台且观察验收通过后，才能安排下线。

## 历史试点与签收优先级（仍未被技术测试替代）

1. **P0：完成生产启动恢复人工签收。** 精确 SHA、`/api/health` 和 `/healthz` 已确认；
   继续补齐真实登录与 Seed completed/skipped 状态证据，再关闭生产恢复 Issue。
2. **P0：完成人工安全签收。** 轮换可能暴露的模型 Key，人工确认 Secret Ref、出口、
   Package 禁用和 Workspace 隔离边界。
3. **P0：完成真实业务试点。** 由业务方独立完成运行、审核、评分、回归和 Trace 查看，
   逐项勾选 `docs/ACCEPTANCE_V1_LITE.md`。
4. **P1：根据试点决定下一主线。** 稳定性不足则优先正式迁移、备份、队列可靠性和观测；
   价值不足则选择一个真实数据源或通知渠道，不再按细版本编号惯性扩功能。


## 2026-07-13 真实试点问题

审核上下文修复已合并并部署，线上默认 Workflow 为 `v1.3.0`；使用非空审核理由的真实模型复测
确认 `reviewedArtifact`、审核决定和审核理由已经进入“审核后修订”输入。

同一次复测暴露新的 P1 可靠性缺陷：模型空输出仍被 Agent Runtime 标记为成功，导致 NodeRun
显示通过、没有 Artifact，并由工作流原始输入驱动下游继续执行。当前工程修复已把空字符串和纯空白
响应纳入有限重试；耗尽后 NodeRun 与 Run 失败并停止 DAG，不创建空 Artifact 或 Human Review。
短但非空输出仍走现有低分复核路径。

该可靠性修复已合并并继续包含在当前 `df1a0cd` 部署中；若尚未完成线上真实模型复测，真实场景问题仍不能视为
完全关闭。即使复测通过，也只证明最低非空输出契约，不代表结构化 Schema 或业务语义一定正确。
此前在对话中暴露的模型 Key 轮换仍是独立的 P0 安全阻断。

## 文档职责

| 信息 | 入口 |
|---|---|
| 当前项目事实 | `docs/project-management/project-overview.md` |
| 领域语言 | `CONTEXT.md` |
| 详细实现与历史版本记录 | `docs/CURRENT_IMPLEMENTATION.md` |
| 当前源码盘点 | `docs/project-management/source-audit.md` |
| 版本台账 | `docs/project-management/version-ledger.md` |
| 当前路线 | `docs/PROJECT_ROADMAP_TO_V1.md` |
| 长期蓝图 | `docs/PROJECT_MASTER_PLAN.md` |
| V1 Lite 验收 | `docs/ACCEPTANCE_V1_LITE.md` |
| 当前功能 PRD / Issue | `.scratch/<feature>/` |

`.scratch/` 默认被 Git 忽略，只适合本地任务管理。任何会影响后续会话、部署、产品边界
或安全判断的长期结论，都必须同步到受 Git 跟踪的文档、源码或测试中。
