# 04A 引用资产迁移

Status: verifying
Owner: Python / TypeScript / React

用户已确认设计与实施计划，授权本地编码与测试；不包含部署、生产切流、真实数据治理或真实外呼。

- 规格：`docs/superpowers/specs/2026-09-05-netlify-reference-assets-design.md`
- 计划：`docs/superpowers/plans/2026-09-05-netlify-reference-assets.md`
- Issue：`.scratch/netlify-native-migration/issues/04a-reference-assets.md`

## 验收与当前边界

- [x] Python/TypeScript 共用合成配置 fixture，拒绝内联凭证配置与不安全 URL。
- [x] 历史日志与审计输出投影。
- [x] Python API 接入及错误响应保护。
- [x] 13 个 TypeScript 接口及真实隔离 PostgreSQL 重放。
- [x] 页面迁移模式与隔离浏览器验收。
- [x] 全量回归、对抗审查、本地工程验收。

最新：本地工程通过，Issue 进入 ready-for-human；生产发布/切流未执行。
后端 481、前端/脚本 400、资产 PG 198、身份 PG 129、浏览器 3 条通过，详见 verify.md。
review.md 记录本轮发现与修正、能力限制；后续旧段落仅保留开发历程。

登记配置校验只限制允许结构，不解析凭证、不进行 DNS/HTTP 请求，也不证明 URL 可达或获准外呼。
Python 配置规则已接入创建、编辑、列表和停用响应；历史摘要与审计投影已接入只读接口。
尚未部署，不能描述为线上安全问题已修复；TypeScript 13 条路由已通过本地契约、PG 与页面门禁。
休眠 Function 不配置生产路由，本地工程完成不等于全量生产迁移完成。

## TDD 与对抗核查

- Python 首次运行因策略模块不存在失败；最小 manual 拒绝实现后 1 项通过。
- 共享用例引入后合法 HTTP 用例 3 项失败；实现 HTTP URL 规则后转绿。
- TS 首次可执行运行因策略模块不存在失败；实现后共享用例通过。
- Vitest 首次被沙箱阻止子进程启动，不计为业务 RED；批准沙箱外本地运行后取得真实 RED。
- pytest 全量初次受临时目录 ACL 阻断；未作为代码回归或通过证据。
- 最终聚焦：Python 40 项；Vitest 策略 39 项 + 既有身份 24 项，共 63 项通过。
- lint 无警告；build/typecheck/deploy:check 通过（build 保留既有大 chunk 提示）。
- 边界：DNS ASCII label、IP 字面量与数字别名、userinfo、query/fragment、端口、控制字符、未知配置键。
- 配置输入前后深比较相等，未补写默认 method；错误仅固定消息，不带被拒绝值。
- 全量 Vitest：54 文件、372 项通过。后端全量在全新 `.scratch/reference-assets-tests-<随机标识>`
  隔离目录、沙箱外运行退出 0；期间新增的 7 个 URL 边界另经最新 Python 聚焦 40 项验证。
  后端保留既有 Starlette/httpx 弃用提示，不安装新依赖来消除提示。
- 后端命令：`apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q -p no:cacheprovider --basetemp=<本次全新目录> -x --tb=short`。
  目录均为本次独立创建的测试产物，未清理既有数据或修改系统临时目录权限。
- 全量 Vitest 命令：`npm test -- --run --maxWorkers=1 --no-file-parallelism`。
- 未提交、未推送、未部署；第 1 步仅配置部分完成，历史输出投影及后续步骤仍待实现。

## 用户扩大为全部 9 项后的续接

- 全量范围与门禁见 `docs/project-management/netlify-migration-execution.md`；不再按小步骤重复询问继续。
- 本轮新增 `reference_asset_http.py`、API 安全测试及 TS 路由解析：固定校验错误、配置写入拒绝、
  历史配置读取 409、Provider URL/null/快照引用校验、摘要隐藏、审计字段投影与关联 Workspace 校验。
- 每个保护接缝均先观察到缺失行为的 RED；13 个新增 Python API 安全用例通过。
- TS 配置、路由和既有身份聚焦共 80 项通过；路由解析不等于 13 个端点已实现。
- 首次全量后端 457 通过、6 失败：旧原文断言、无关联实体的旧日志夹具、自由配置 MCP 登记夹具。
  已按获批契约更新原文断言；日志夹具增加真实 Agent 并使用 nullable 运行关联；
  MCP 通过直接合成历史记录保留原执行网关断言，不放宽新登记规则。相关 11 项复测通过。
- 最终全量重跑已完成：后端 463 项、前端/脚本 55 文件 389 项通过，详见 verify.md。
  lint、build/typecheck、deploy:check、diff check 通过；首次失败与修正证据仍保留。
- 本地 PostgreSQL 门禁受阻：5432 未监听，Docker CLI 已安装；尝试启动 Docker Desktop 后进程存在，
  但引擎管道 `dockerDesktopLinuxEngine` 仍不存在。WSL 程序在 System32 存在且报告默认 docker-desktop / WSL 2；
  不是已确认的 WSL 缺失。尚未拉取镜像、创建数据库或更改系统配置，已请用户提供 Docker 窗口提示。

## Docker 恢复与数据库实现续接（覆盖上段环境阻断）

- 已定位 Docker 启动日志中的陈旧 runtime socket 删除失败；只保留重命名相关运行时目录，未重置 Docker、删除镜像或业务卷。
- Docker Server 29.5.3 恢复；复用缓存 postgres:17-alpine，不拉取镜像。本机 5432 为 Windows 保留端口，采用 loopback 55432 合成内存库。
- 身份 handler 提取通用请求边界；Postgres 提取原事务/Workspace/权限/审计帮助函数，没有复制登录系统。
- 新资产 PG 测试先因模块缺失失败；Tool、impact、history 分别先观察 501 后补实现转绿。
- 历史快照显式 null Secret Ref 对抗测试曾得到 200，修正为 409；保留此 RED/GREEN 证据。
- Provider/Tool 的创建、编辑、停用、列表，两个 impact、两个 audit 及 invocation list 都有非空合成数据库验证。
- 本轮资产 PG 83 项、身份 PG 129 项、聚焦 Vitest 85 项、全量 55 文件 / 394 项通过。
- 新数据库测试已接入 CI 工作流定义；未推送，不能宣称远程 CI 已运行。
- 未新增公开资产 Function 或生产路由。完整跨语言重放、页面 E2E、历史异常投影对齐仍是签收缺口。
