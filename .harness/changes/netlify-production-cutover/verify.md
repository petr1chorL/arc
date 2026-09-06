# 07/08 本轮事实回执

日期：2026-09-06。进行中快照，**不是生产迁移验收通过报告**。

## 已发布的精确版本

- 04A–06 基线 `a4894b3366d6fe95e2f30ee2b91ad15e92b29bbd` 已推送；CI `34013885627`
  失败原因已定位为 Workflow 过期 effect 继续发起版本查询，触发 429。修复未提高或绕过限流。
- 修复提交 `b62660223dad8b43a725bd9bf847959ac511b2a8` 已推送到
  `petr1chorL/arc` 的 `codex/harness-governance`，未强推。
- GitHub CI [34020649346](https://github.com/petr1chorL/arc/actions/runs/34020649346)：全部成功。
- Netlify site `0ba326b9-88aa-4df4-8fab-daa2ae5894b7` 的正式部署
  `6a9d1d993c53f700086e848e` 为 ready/current，commit_ref 精确匹配 b626602 完整 SHA，
  published_at 为 `2026-09-06T08:14:23.375Z`，无错误信息。
- `/api/*` 仍代理 Zeabur；公开原生 runtime/AWL/schedule 入口硬休眠。这不是后端切流。

## 后续准备增量：本地整合通过

- 全域纯路由组合身份与九个业务域，默认关闭零依赖访问；六项测试和独立审查通过。
- 显式 Workspace/host/SecretRef 绑定的运行依赖工厂，双费率、不可变配置和脱敏发送前失败；
  五项测试与独立 Spec/Standards 两轴审查通过。没有真实 Secret/模型/通知访问。
- Provider 配置检查、当前可编辑 Agent 面迁移；历史版本不修改。
  七项 PostgreSQL 测试通过，含 Unicode 与独立 Session 的真实锁交错；复审关闭原两项问题。
- 旧 Worker 手工领取 410；Run 删除仅 409 安全拒绝，跨空间/缺失 404，拒绝审计持久化。
  三项测试通过；不会领取任务或删除业务记录。成功删除能力仍未迁移。
- 只读源库盘点 SQL 检查 43 张基线表及六类状态计数；三项合成测试通过。
  缺表/列、只读写入拒绝、锁超时均有失败证据；未连接生产，不等于备份或最终对账。
- 主线程最新 `ARC_RUNTIME_TEST_PORT=55433` + `node scripts/verify-runtime-local.mjs`：
  **17 个测试程序全部通过**，合成数据库/外部适配器，不是 17 个生产场景。
- 主线程 lint、build（含前端/Netlify 类型检查）、deploy:check、diff check 通过。
  sandbox Vite 子进程 EPERM 后在已授权执行环境构建成功，没有修改构建语义绕过失败。
- 本批增量的提交后 CI/Netlify 状态尚待记录；不能复用 b626602 的云端结果为后续代码背书。
- 两份既有 2026-08-13 研究文档保持原样，不纳入提交。

各切片 RED/GREEN、范围和独立结论见本目录 native/provider/runtime/source 对应回执。

## 生产控制面实际检查与阻断

Chrome 已登录，部分操作恢复但明显缓慢，之后仍出现 Debugger unattached/超时。
项目 `6a4f5a4fc2881a93656ecf10`，环境 `6a4f5a4f104975fcb4675e6b`：
`postgresql`、`arc-web`、`arc-api-live`、`arc-v1-lite` 四项服务显示运行。
PostgreSQL 服务 `6a4f5a4fc2881a93656ecf11`，镜像 `docker.io/library/postgres:18`；
“备份还原”和“数据库”页仅功能介绍与“升级方案”，无可用备份/查询入口。

`arc-v1-lite` 服务 `6a4fb49cf04125ac9a341c0c` 的域名匹配现有生产代理；硬盘页无挂载。
这不足以确认真实数据库连接；未展开任何凭证。
命令页终端反复 `Connection lost. Reconnecting.`，只读命令未取得执行结果，随后停止继续输入。
因此尚未取得生产源库、任务数量或备份的有效快照，不能写空库/零任务。

[官方价格页](https://zeabur.com/pricing)显示 Dev 每月 5 美元；已单独请求用户是否授权首月最多 5 美元、无额外费用/续费。
尚未收到答复，未进入成功结算、未购买/升级，也未确认当前账户试用资格。
系统提示 `victoria-metrics` 异常仅记录平台报告；未更新 ZeaburOS 或重启资源。

## 尚未完成与接续

1. HTTP Tool 独立异步测试与成功 Run 删除契约；公开宿主、真实模型/通知/Tool 许可、AWL 和调度接线。
2. 源库准确连接/状态盘点、备份校验及独立恢复、旧非终态任务处置与最终对账。
3. 隔离云端真实业务验收、单主切流、应用与数据回滚演练。
4. 有实际负载证据的稳定观察及 Zeabur 退役。

没有冻结/修改生产、取消真实任务、迁移业务数据、关闭资源或创建观察自动化。
先核对本批发布；源库可稳定访问后执行只读盘点和备份，不把升级购买本身当成迁移完成。
