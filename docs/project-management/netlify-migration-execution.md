# Netlify 全量迁移执行账本

## 最新刷新：2026-09-06

`b626602` 已推送；CI `34020649346` 全部通过，Netlify `6a9d1d993c53f700086e848e`
已正式发布同一 SHA。下表的“未发布/未提交”等为先前本地交付快照；当前原生代码虽随构建分发，
公开入口仍关闭，生产 `/api` 仍代理 Zeabur，不代表原生能力启用或真实数据已迁移。
纯路由/依赖装配、Provider 兼容、安全拒绝旧控制操作及只读源库盘点为本轮后续准备，
精确测试和本批提交后的云端状态见 `../../.harness/changes/netlify-production-cutover/verify.md`。
生产终端持续断线，备份/数据库 UI 要求升级；未付费、未读取凭证、未迁移或关闭资源。
07/08 继续 in-progress；先解决源库可访问性，再按独立恢复、任务盘点、对账和云端业务验收推进。

2026-09-05：用户明确要求完成截图中的全部 9 项。此请求取代按小步骤反复询问是否继续的节奏，
但不降低测试、数据对账、回滚和稳定观察门禁。项目当前事实仍以 project-overview.md 为入口。

| 项目 | 当前状态 | 完成证据要求 |
|---|---|---|
| 04A Provider、Tool/Skill | 本地工程验证通过、ready-for-human；未发布或切流 | 13 条接口、PG 198 项、浏览器 3 条、后端 481 / 前端脚本 400 项及 review.md |
| 04B Agent 草稿、发布、停用 | 本地工程ready-for-human，终审及异步页面保护完成；未发布 | PG232、当前Python591、前端605、浏览器8条；review/verify回执 |
| 04C Data Object、Schema、版本 | 五条治理路由、本地 PG/双栈/浏览器验证完成，ready-for-human；未发布或迁移真实数据 | 详见 `.harness/changes/netlify-data-object-lifecycle/`，不得等同生产迁移 |
| 04D 评估量规、Golden Sample | 本地工程ready-for-human；九治理路由、页面/休眠入口及两轴终审完成；未发布 | 量规PG161、候选PG139、8个真实资格管理竞争；同库浏览器完整生命周期 |
| 04E Workflow 编排、校验、发布 | 本地工程ready-for-human；八治理路由与两个只读目录完成，未发布/切流 | PG202/56组共享HTTP、6组锁竞争/44检查、Python PG、浏览器工作流闭环及review/verify |
| 执行、异步、通知、定时 | 本地工程 ready-for-human；公开入口硬休眠，未部署 | 12 个 runtime 程序、前端677、两轴严重问题0；代次/取消/不确定核对/原子终态/调度与投递持久化 |
| 审核、评估、整改、产出物、追踪 | 本地工程 ready-for-human；未生产切流 | 人审修改恢复、评分/回归/复测、版本/Trace，5 条 Chromium；外部适配器受控 |
| 备份、数据迁移、切流与回滚 | 尚未执行 | 恢复演练、冻结边界、主键/行数/汇总对账、精确部署验收 |
| 稳定观察与关闭 Zeabur | 尚未执行 | 新平台闭环无旧平台依赖、观察证据、最终快照与可恢复方案 |

## 执行规则

- 日常本地编码、测试、修正按依赖连续推进，不按每个小函数要求用户重复确认。
- 后续切片先核对当前源码契约，再写规格与测试，不根据表名批量生成 CRUD 冒称迁移完成。
- 遇到需要新费用、真实外部副作用、无法自动决定的数据处置或影响业务的取舍，集中说明所需决定。
- 生产保持现有完整链路，不能将新资产 ID 交给旧数据库上的业务接口。
- 不关闭仍承担 API/Worker/业务数据的 Zeabur，不把空 schema、健康检查或 Fake 测试当作完整验收。
- 无后台自动化已创建；账本描述工作范围与证据，不表示未运行时仍在后台开发。

## 当前接续位置

最新接续补充（2026-09-06，05/06）：设计提案位于
`../superpowers/specs/2026-09-06-netlify-runtime-closure-design.md`。
已复现旧通知发送确认与提交间的重复窗口，核对 AWL 检查点不能提供外部 exactly-once。
用户已确认长操作 202 + Operation，以及无幂等接收方的结果不确定时暂停自动重发。
05/06 已完成本地实现、两轴审查和完整门禁收尾，ready-for-human，证据见
`../../.harness/changes/netlify-runtime-closure/`。公开 Function 无事件/计划订阅且返回 404；
生产 AWL 连接、真实外调、数据迁移与切流属于后续验收，尚未执行。

04A：`../superpowers/plans/2026-09-05-netlify-reference-assets.md`。
已接入 Python 配置写入拒绝、历史读取阻断、摘要隐藏、审计投影及关联校验；
Docker 已恢复，使用缓存镜像运行 loopback 55432 合成 PG；TS 资产后端的 CRUD、非空影响面、
调用历史与审计共 198 项检查通过，包含 26 个共享请求、52 个角色/路由检查及历史输出边界。
迁移模式浏览器 3 条闭环通过，清理已独立对账；后端全量 481、前端/脚本 400 项通过。
04A 本地工程验收已完成，生产发布不在这些证据之内。下一接续点为 04B 契约重放与设计，
盘点见 `../superpowers/specs/2026-09-05-netlify-agent-lifecycle-contract.md`；动态结果及推荐
兼容决策见同目录 `2026-09-05-netlify-agent-lifecycle-design.md`，用户现已确认并进入本地实施。
最新接续（2026-09-06）：04A–04E本地工程已验收进入ready-for-human，未提交/推送/发布；回执见各自 `.harness/changes/`。
当前前端656、浏览器9条、身份PG129/资产198/Agent232/Data Object62/量规161/候选139本轮通过；此前8个资格管理竞争证据保留。
Python全量基线629通过，最后嵌入历史保护另有7项定向通过；旧worker间歇卡顿根因未查明，未运行远程CI。
04E工作流CRUD、编排与版本校验、发布、历史、软删除和两个审核只读目录均完成，PG202/56共享HTTP、6组锁竞争/44检查及Python PG通过。
设计见 `../superpowers/specs/2026-09-05-netlify-workflow-lifecycle-design.md`，计划见 `../superpowers/plans/2026-09-06-netlify-workflow-lifecycle.md`。
04E已完成本地工程门禁。下一接续是执行引擎/异步任务/通知/定时迁移，再进行运行闭环和真实数据切换。
不得宣称生产资产或整个平台迁移完成。验证记录在 `.harness/changes/netlify-reference-assets/`。
