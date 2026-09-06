# 07/08 本轮事实回执

日期：2026-09-06。进行中快照，**不是生产迁移验收通过报告**。

## 最新增量状态

2026-09-06 再次收口：52e36f8 / CI34025942754 已通过前端/Python/身份PG，但资产PG历史返回503失败。
本地原样复现并确认测试库缺runtime_operations；已将资产PG及浏览器fixture同步到既有完整结构加载器。
原合同198检查/52角色路由/26共享请求、22原生程序、9浏览器场景及lint/build/deploy:check通过。
具体RED/GREEN及Python虚拟环境边界见 asset-fixture-migrations-verify.md，不预报新提交CI成功。
0a35e929旧CI最终前端Worker异常失败；52e36f8也因额度跳过Netlify，当前发布仍b626602。

2026-09-06 最新补充：观测页已稳定复现并修复 URL 双向同步振荡、旧详情迟到覆盖两条缺陷；
独立14例与审查通过，主线程71文件696项完整8分片连续PASS、7浏览器场景PASS、lint/build PASS。
详见 observability-navigation-verify.md；不声称所有历史卡死只有同一根因。
Tool提交0a35e929已推送；其CI在本快照仍执行中，不能预报成功。
本机Netlify CLI登录及站点关联已验证。最新API确认最近四次Git push实际触发构建，
但都因 `Skipped due to account credit usage exceeded` 被跳过，故当前发布仍为b626602。
仓库持久连接不是阻断原因；需要额度恢复或明确费用授权，不继续重复触发或擅自升级。

2026-09-06 后续刷新：`1940c36` / CI `34022125444`、`2f51d8e` / CI `34023212681`
均已全步骤成功；Netlify 接口当前部署仍为 b626602 对应的 `6a9d1d993c53f700086e848e`。
部署工具只给本地上传命令，未触发构建；没有上传含未完成工作的工作区。浏览器控制台再次超时。
不能声称 Git 持久自动部署已验证或最新版本已上线。
HTTP Tool 独立 202 本地实现、双轴审查和 7 场景浏览器已通过，70 个前端文件最终分片通过；
期间出现未确定根因的间歇卡死，不能把重跑通过写成稳定性缺陷已修复。
后续空输出与同页幂等重试修复及准确测试结果见 tool-test-verify.md。
以下 17/18 程序、Tool 未实施及云端待核对表述为此前快照，由本段及 Tool 回执更新覆盖。

内部API宿主后续接线本地完成：Provider存在性/费用选项已到达真实后端，18程序、
边界回归、lint/build/deploy:check通过，两位独立Spec/Standards审查无阻断；仍未公开启用。
具体结果见 native-api-host.md；备份格式/版本/恢复范围补充见 backup-restore-boundary.md。
Tool独立202已进入后续实施，不能在本宿主切片里将其标为完成。

准备代码已提交推送为 `4c65b48f05a448b233d34340d1a0da303ce39261`。
CI `34021720282` 前端测试入口失败：Node 测试被 Vitest 误收集；修正与新回归见 test-runner-fix.md。
修正后本地全量 Vitest 69 文件/681 项、lint/build/deploy:check 通过，独立审查未发现漏跑。
不能把该提交记为云端通过。最后确认正式发布仍为下节的 b626602。
本轮匿名只读 HTTP 检查：首页 200 且标题 ARC.ONE Agentic OS，/api/health 200/status ok，
原生 runtime/runtime-scheduled 404；浏览器打开站点仍超时，未验收登录后真实业务。
本轮一次性合成容器 arc-one-cutover-verify-20260906 的随机 schema 已核对为空并已移除；
没有删除真实数据或其他容器。

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
- 本批增量的提交后 CI/Netlify 状态以上方最新增量段为准；不能复用 b626602 的云端结果为后续代码背书。
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

1. 恢复Netlify额度后发布已推送修复并完成精确CI/部署验收；成功 Run 删除契约、公开宿主、真实模型/通知/Tool 许可、AWL 和调度接线。
2. 源库准确连接/状态盘点、备份校验及独立恢复、旧非终态任务处置与最终对账。
3. 隔离云端真实业务验收、单主切流、应用与数据回滚演练。
4. 有实际负载证据的稳定观察及 Zeabur 退役。

没有冻结/修改生产、取消真实任务、迁移业务数据、关闭资源或创建观察自动化。
先核对本批发布；源库可稳定访问后执行只读盘点和备份，不把升级购买本身当成迁移完成。
