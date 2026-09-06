# 05/06 独立 Standards 轴审查

日期：2026-09-06。审查者：独立 Standards 子 Agent。范围为用户批准的执行系统和运行闭环本地迁移；不审查既有 04A–04E 未提交改动，也不代表生产发布验收。

依据：项目 `AGENTS.md`、`.harness/rules/编码规范.md`、`工程结构.md`、已确认 runtime-closure 设计与计划，以及 `expert-reviewer-front` 的独立 Standards 轴。使用项目 React 规则，未套用 Skill 的 Vue 假设；领域词汇使用根 `CONTEXT.md`。

## 当前结论

发现的 2 项严重问题均已修复并独立复验，**当前未解决严重问题 0 项，Standards 轴可放行进入最终集成门禁**。不替代 Spec 轴、完整回归和事实文档回执，也不是云端验收。

## 严重问题

### T1：同类型旧渠道停用会遮挡后续有效渠道（已修复，独立复验通过）

位置：`netlify/functions/_shared/runtime-delivery/notifications.ts:39`。

发送器以 `workspace_id + channel_type` 查询后按 `created_at,id LIMIT 1` 选择第一条，再判断 active。当旧渠道 disabled、新渠道 active 时，选择旧渠道并返回 `channel_disabled`，实际有效配置永远不会进入发送器。渠道创建只约束名称唯一，允许同类型多条，因此这是合法配置的失败路径，不是畸形数据库假设。

复验方式：同 Workspace 内插入较早 disabled email 和较新 active email，创建一条 email 通知，使用受控计数 adapter 消费；应选 active 配置并只调用一次。仍须保留全部 disabled 时不外发、其他 Workspace 配置不可用的边界。

修复后按 active 优先，再按 `created_at,id` 确定选择。独立运行 delivery PostgreSQL 程序，51 项断言通过；新增断言确认选择有效 Email，全部 disabled 时返回 `channel_disabled` 且 adapter 调用数为 0。

### T2：新增 CI PostgreSQL 端口覆盖未被 delivery 测试采用（已修复，独立复验通过）

位置：`scripts/runtime-delivery-postgres.mjs:16`、`.github/workflows/ci.yml:110`、`scripts/verify-runtime-local.mjs:10`。

CI PostgreSQL 服务映射 `5432:5432`，新增运行门禁设置 `ARC_RUNTIME_TEST_PORT=5432`。但 delivery PG 程序只读取 `process.argv[2] ?? 55432`，聚合脚本没有传端口参数，因此该程序仍连接 55432；即使其他本地测试通过，此门禁在声明的 CI 环境也无法通过。

复验方式：统一采用与 `runtime-test-db.mjs` 相同的非敏感测试端口约定，保留参数兼容并校验端口；以显式环境端口运行 delivery 程序，并检查聚合脚本和 CI 的组合不再隐式回落 55432。无需安装依赖、访问云端或读取凭证。

修复后优先级为显式参数、`ARC_RUNTIME_TEST_PORT`、本地默认端口；范围校验 1..65535。独立设置环境端口 55432 且不传参数，51 项 PG 检查通过；独立设置环境端口 0，在连接前于第 17 行校验失败退出 1，证明环境值确实生效而非被忽略。源码确认 CI 的 5432 覆盖沿相同接缝传递；未冒称实际跑过 GitHub Actions。

## 建议改进（非阻断）

- `runtime-closure/queries.ts:67` 的总览 alerts 直接筛选通知行的 status，而外部不确定通知仍存为 dispatching，由 Operation 状态在通知专页投影为 needs_reconciliation。总览因此可能遗漏此类告警。当前 Operation 和通知专页仍能明确查询和恢复，不是执行安全失效；建议复用状态投影或明确总览不是所有不确定投递的完整告警台。
- 部分 runtime-closure 函数包含密集单行 SQL/分支，可维护性弱于独立的小函数。项目并无机械函数行数门槛，此为后续有测试保障的小步整理建议，不要求扩大本次重构。
- 当前逐行为、真实 PG 竞争与浏览器测试证据有价值，但未产生可靠的 runtime 核心覆盖率报告；不应宣称已验证 80% 数值覆盖率。

## 通过项与验证边界

- HTTP 层复用 Session、CSRF、Workspace 与 capability 接缝，通用 Operation 入口额外限制 notification 管理权限。前端隐藏按钮不作为后端授权依据。
- 业务写入使用 Operation generation、status 和 lease fencing；子恢复在继续外发前也检查关联 Run 取消，不能仅依赖原 Operation 状态。
- 终态与 Run/Node 投影通过同事务 callback 提交，包括 claim 阶段不确定与死信分支，避免终态重复事件无法修复业务状态。
- 外部 effect 先持久化意图，确认结果独立保存并以 attempt 防止旧尝试回执覆盖新尝试；未知结果禁止普通重投，核对重试要求显式风险确认与原因。
- Gateway 在凭证解析前验证 Workspace/Host/Secret Ref 绑定，拒绝 IP、非 HTTPS、重定向等路径，响应大小和总时限有界。未调用真实模型或读取凭证。
- 前端 API 调用集中于 `src/api`，不追随服务端提供的任意 statusUrl；Operation 中心只存用户/Workspace 作用域下的 ID，重载结果与权限，切换时中止读取；202 与业务完成分离。
- 新部署入口是硬休眠，后台事件订阅为空，无 schedule 注册；本轮源码不能据此宣称已在 Netlify 云端运行、已切流或已关闭 Zeabur。

独立实际执行：

- `node --experimental-transform-types scripts/runtime-ledger.test.mjs`：退出 0，12/12 通过，真实 loopback PostgreSQL 随机 schema 与清理。
- `node --experimental-transform-types scripts/runtime-gateway.test.mjs`：退出 0，4/4 通过，受控 transport / stream，无真实外部请求。
- 设置 `ARC_RUNTIME_TEST_PORT=55432` 后执行 `node --experimental-transform-types scripts/runtime-delivery-postgres.mjs`：51 项检查通过、`externalNetworkCalls=0`、隔离 schema 清理完成。
- 设置 `ARC_RUNTIME_TEST_PORT=0` 后执行同程序：预期退出 1，在创建数据库连接前校验失败；这是无效端口负例通过，不是门禁失败。

最终 lint、build、完整前端回归、浏览器及 Issue AC/事实文档同步由主线程汇总。本报告不将尚未汇总的结果当作已完成证据，也不替代独立 Spec 轴报告。
