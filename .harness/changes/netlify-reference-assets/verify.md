# 04A 本地开发验证回执

日期：2026-09-05。状态：04A 本地工程验证通过，等待发布边界验收；全量迁移未完成。

## 最新工程验收（覆盖下方早期接续状态）

| 检查 | 命令 | 结果 |
|---|---|---|
| 后端全量 | `apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q -o addopts='' -p no:cacheprovider --basetemp=.scratch/assets-full-final-20260905 -x --tb=short` | 481 passed，351.47 秒，退出 0 |
| 前端与脚本全量 | `npm test -- --run --maxWorkers=2 --reporter=dot` | 55 文件、400 passed，51.37 秒，退出 0 |
| 资产 PG | `node --experimental-transform-types scripts/test-reference-assets-postgres.mjs 55432 apps/api/.venv/Scripts/python.exe` | 198 checks；26 个共享请求匹配；52 个角色/路由检查 |
| 身份 PG | `node --experimental-transform-types scripts/test-identity-postgres.mjs apps/api/.venv/Scripts/python.exe 55432` | 129 checks；旧契约匹配、并发管理员保护通过 |
| 隔离浏览器 | 设置 `ARC_ONE_TEST_PG_PORT=55432` 后运行 `node node_modules/@playwright/test/cli.js test --config=playwright.reference-assets.config.ts` | 最终代码上 3 passed，8.5 秒；退出 0，独立连接确认 schema 清理 |
| 静态门禁 | `npm run build`、`npm run lint`、`npm run deploy:check` | 全部退出 0，lint 无警告；build 保留既有大 chunk 提示 |

最终 PG、前端全量、类型/构建与浏览器均覆盖最后的 TS 审计显式 null 原因修正。
`git diff --check` 退出 0；仅保留 Git 换行格式提示，未发现补丁空白错误。

本轮补齐审计 envelope 有限状态/目标归属、非对象 metadata、损坏快照固定 409、null 原因差异；
Python 先出现 6 个错误 200 与 6 个 AttributeError，PG 先复现错误 200，再修正为拒绝。
新增排序夹具首次因缺少 baseline 必填列失败，该次仅为测试夹具错误，不算业务 RED；补齐后通过。
清理代码 lint 警告已修复为保留所有错误的聚合反馈；未忽略清理失败。

CI 已加入隔离浏览器与锁定 Playwright Chromium 安装步骤，仅定义在临时 runner 执行；本轮没有本机下载、
推送或远程 CI 运行。生产路由、迁移文件、package/lock 均无差异；没有生产写入或 Zeabur 操作。
截图已实际查看，包含隔离环境标识、停用资产、持久审计和隐藏调用摘要。
审阅与局限见 `review.md`。以下段落保留开发过程，不再表示当前未完成项。

## 此前验证证据

- 新增 Python API 安全测试 13 项通过：配置拒绝与不持久化、PATCH 最终组合与回滚、历史读取/停用阻断、
  Pydantic 错误不回显、Provider URL/null/快照引用、摘要隐藏不改原文、审计投影与跨 Workspace/缺失引用。
- 配置/路由/身份 Vitest 聚焦 80 项通过；其中新增路由解析 17 项。没有测试调用或迁移草稿路由开放。
- 最终前端/脚本全量：55 文件、389 项通过，退出 0。
- 最终 build（含 Netlify typecheck）、lint、deploy:check、diff check 通过。
- 后端全量首次 457 通过、6 失败；意图差异与夹具修正见 change.md，相关 11 项复测通过。
- 最终后端全量：463 项通过，1 条既有弃用提示，退出 0（368.87 秒）。
  采用本次新建隔离测试目录；未接入业务库。

## 保留的警告与不足

- Vite 现有超过 500 KB 的 chunk 提示；Node localstorage 提示；Starlette/httpx 弃用提示。
  未为消除这些提示引入升级或重构。
- 现有 PG 测试不是完整跨语言契约重放；迁移页面浏览器验收、云端发布、生产数据对账和切流尚无证据。
- 此前 Docker 引擎未就绪已解决，具体环境与恢复目录见下节；不再需要用户提供窗口截图。

## 对抗审阅与范围

- 保留 API 权限检查、Session/CSRF 入口及原审计事务；配置拒绝在写入前发生。
- 摘要只替换响应副本；无数据库清洗、历史快照改写或记录删除。
- 旧 MCP 执行通路仍用 Fake 网关与合成历史配置验证；新登记仅允许空 MCP 配置。
- 只读日志/审计未变更排序和筛选；异常历史引用失败关闭，不伪造空列表。
- 这不是整个运行系统的凭证防泄漏证明：未迁移的运行接口、全局审计、自由业务文本仍需各切片审阅。
- TypeScript 内部资产后端已经实现，但当前没有新公开资产 Function 或页面迁移验收。
- 无提交、推送、部署或生产写入；Zeabur 仍承担原有生产职责。

## 最新本机 PG 与完整前端回归

- `node --experimental-transform-types scripts/test-reference-assets-postgres.mjs 55432`：83 项通过。
  包含真实登录、持久化、并发唯一性、审计失败回滚、角色差异、跨 Workspace、非空影响面、
  审计/调用历史筛选、摘要隐藏不改源记录、历史异常拒绝。尚未覆盖完整角色/异常矩阵或全量跨语言等价性。
- `node --experimental-transform-types scripts/test-identity-postgres.mjs apps/api/.venv/Scripts/python.exe 55432`：
  129 项通过，Python 身份契约 matched，并发最后管理员保护通过。
- 聚焦 Vitest 85 项通过。首次全量进程长时间无输出后中止，不记为通过；
  `npm test -- --run --maxWorkers=2 --reporter=verbose` 重跑：55 文件、394 项通过，50.05 秒。
- lint、build（含 Netlify 类型检查）、deploy:check、diff check 通过；保留既有大 chunk、换行格式提示。
- 后端 Python 本轮未再修改；463 项为此前全量证据，不冒称本轮重新运行。

## 测试环境恢复与可恢复目录

- Docker 日志确认 runtime socket 重解析条目导致启动清理失败；未 factory reset、未删除业务卷或镜像。
- 仅重命名已核实的运行时目录保留恢复副本：
  `C:\Users\a\AppData\Local\Docker\run.recovery-20260905`、
  `C:\Users\a\AppData\Local\docker-secrets-engine.recovery-20260905`、
  `C:\Users\a\AppData\Local\Docker\run.recovery-20260905-final`。
- 使用本地缓存 postgres:17-alpine（742f40ea20b9），工作容器 `arc-one-migration-test-55432`，
  loopback 55432、tmpfs 数据目录；仅合成数据，停止容器后不可依赖数据保留。
- 最初 5432 映射失败的空容器 `arc-one-migration-test-20260905` 保留 created 状态，未作为成功环境。
- PostgreSQL 每轮创建随机 schema 并仅移除自身 schema；不连接或清理生产库。

## 下一验收缺口

- 尚需完整 Python/TS 重放；例如 TS impact 对快照 Agent 归属、snapshot.id 与 agent_id 不一致额外拒绝，
  Python 影响面当前未统一这些异常边界，不能称完全兼容。
- 审计异常 target/outcome、全部历史 malformed 数据与权限矩阵仍需对抗覆盖；不是通用防泄漏证明。
- 尚需休眠 Function、迁移模式页面、同库隔离 E2E 与浏览器验证；不能向旧 Zeabur 传新库资产 ID。

## 共享请求重放续接

- 新增 `fixtures/reference-assets-requests.json` 和 Python 重放脚本；PG 脚本执行相同 26 个请求，
  对比状态码与完整 JSON，仅归一化随机 ID/时间。覆盖 13 路由的基本契约，非空历史仍由独立 PG 用例覆盖。
- 实测发现 Tool PATCH 双别名在 Python 为 422、TS 为 200；增加重复别名拒绝后转绿。
- 最新资产 PG 共 110 项通过，26 个共享请求 matched。命令：
  `node --experimental-transform-types scripts/test-reference-assets-postgres.mjs 55432 apps/api/.venv/Scripts/python.exe`。
- Python 影响面新增缺失/跨 Workspace/快照 ID 不一致的 Agent 拒绝测试，两类资产共 6 例；
  首次缺失引用得到 200，接入归属校验后相关三个测试文件通过。上述 Agent 引用差异已对齐，其他 malformed 边界仍待覆盖。
- Provider 页面新增影响面失败测试，首次因仍显示零依赖而失败，修改为明确不可用提示后页面 5 项通过。
- 这不是完整迁移页面验收；浏览器及剩余模式控制仍未执行。完整后端回归已启动，未将运行中状态记为通过。

- 迁移模式续接：新增 `src/api/migrationCapabilities.ts`；仅显式
  `VITE_ARC_ONE_MIGRATION_MODE=reference-assets` 时关闭 Provider/Tool 测试调用并展示范围说明。
  两个页面使用同一能力开关，默认模式保留原功能；未写入生产配置。
- Provider 与 Tool 的按钮禁用测试均先失败后转绿；Tool 首次错误影响面夹具造成的崩溃不算行为 RED，
  修正夹具后重新确认按钮仍可用的真实 RED。最新两页面共 11 项通过。
- 浏览器、HTTP method/url 结构化表单、Tool 旧影响面/审计清理仍待完成；未签收迁移页面。

## 迁移页面数据真实性与配置表单续接

- AssetLibrary 新增编辑后刷新失败测试：原实现保留旧影响面和旧审计，测试 RED；
  现在每次加载先清除对应旧值，失败明确显示不可用/无读取权限，列表不因审计 403 消失。
- 创建资产不再写入假定零引用，创建及编辑后都向后端读取影响面和审计。
- 新增 `AssetRegistrationConfig.tsx`，仅迁移模式使用 HTTP 地址/方法字段；manual/MCP 只显示空配置说明。
  默认模式保留原表单。类型切换明确清空旧适配配置，避免 HTTP 配置带入 MCP 登记。
- HTTP 表单与编辑类型切换都取得真实 RED/GREEN；最新两页 13 项通过。
- 同库隔离服务器、休眠 Function、浏览器 E2E、Provider 审计展示和更完整历史异常矩阵仍待完成。
- 已接回此前完整后端进程并确认退出 0：469 passed，1 条既有弃用警告，345.93 秒。
  命令为 `apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q -o addopts='' -p no:cacheprovider --basetemp=.scratch/assets-full-20260905-contract -x --tb=short`。
- 最新页面修改后的 build/typecheck 与 lint 通过；Vite 保留既有大 chunk 提示。

## 同库浏览器启动续接

- 新增独立 `playwright.reference-assets.config.ts`、`vite.reference-assets.config.ts`、
  `scripts/reference-assets-e2e-server.mjs` 与浏览器生命周期用例，不使用旧 Python E2E 启动器。
- 服务仅监听 loopback 48200/48273，固定本机合成 PG，随机 schema；身份和资产共用同一连接池，未知 API 501。
- 首次因服务脚本不存在启动失败；随后浏览器成功登录，但标题定位有 3 个匹配，修正为 h2，不能把定位错误算业务 RED。
- 修正后浏览器已执行 Provider 创建、重载、编辑、停用和再次重载；最终外域零请求断言失败：原 CSS 加载 Google 字体。
  公共 Layout 的 human-tasks 请求也尚未按迁移模式禁用；仍不得签收 E2E。
- 首次测试退出未释放两个服务，核实本次 PID 后只终止本次两个 Node 服务；未删除业务数据。
  强制结束可能遗留本次合成 schema，未清扫任何不明 schema；其清理仍需后续核实。
- 新增 loopback 专用 POST 退出接缝与全局 teardown，下一轮继续验证退出及随机 schema 清理，不把退出确认当作清理完成。

## 隔离依赖与退出修复

- 隔离 Vite 配置只对本机验证移除 Google Fonts CSS import；生产 CSS 不变。
- 浏览器重新取得 human-tasks 越界请求的 RED，Layout 在资产迁移模式不再轮询未迁移审核接口。
- 明确 Vite 的 loopback 退出接缝后，Provider E2E 已 1 passed，命令正常退出 0（6.1 秒），不再依赖强制终止收尾。
- 已新增 Tool 创建、配置、编辑、重载、停用及审计的真实浏览器用例；两用例完整重跑仍在进行，不记为通过。
- 合成 schema 清理需进一步核对；首次强制退出的合成残留没有擅自删除。

- Tool 首次真实浏览器测试在 HTTP 方法控件定位处超时；添加明确 aria-label 后重跑，Provider/Tool 两用例均通过，7.6 秒，命令退出 0。
- 两条路径都执行真实同库登录、创建、编辑、重载、停用；Tool 还验证持久化 URL/method 和审计展示，未发送外域、审核或测试执行请求。
- 页面截图保存在本地 test-results 的 tool-lifecycle.png；这是合成验收产物，不是生产数据。
- 尚缺非空影响面浏览器展示、Provider 审计页面、完整异常历史矩阵、休眠 Function 与整片签收；不得据此切流。
- 截图核对发现公共顶栏仍标“生产环境”，与隔离迁移模式不符；需要修正标签并补滚动到资产卡片后的视觉证据。

## 环境标识、Provider 审计与非空浏览器结果

- 隔离模式顶栏改为“隔离迁移验证”；浏览器先确认缺失，再修复通过，生产默认标签未更改。
- Provider 页面接入真实审计 API，初始/创建/编辑/停用刷新，失败清除旧记录并独立提示；创建/编辑同时更新影响面。
  浏览器先确认 model_provider.create 不可见的 RED，接入后通过。
- 增加合成 Agent 草稿、发布版本和 Tool 调用记录；浏览器验证两类非零引用计数及调用摘要隐藏。
- 首轮三个用例共用默认客户端触发真实 429；隔离服务器为 allowlist 中的三个合成客户端映射不同文档测试地址，未改限额或生产身份来源。
- 最终浏览器 3 passed（8.0 秒），正常退出 0；两页聚焦 13 项与 build/typecheck/lint 通过。
- 新截图已滚动到资产卡片区域；不再仅以表单顶部截图代替资产状态与审计视觉核对。
- 04A 仍待休眠 Function、全面历史异常/权限矩阵、清理对账及最终全量验收；后续迁移切片未开始。

## 权限矩阵与休眠入口

- 真实 PG 新增 viewer/operator/builder/workspace_admin × 13 路由共 52 项独立预期检查，未引用生产 can() 生成预期。
- 增加失效成员、跨组织拒绝；最新资产 PG 164 项通过，含 26 个共享请求重放。
- 新增 `netlify/functions/reference-assets.mts`，无 path 配置或生产 redirect；直接 Function URL（含伪造 route 参数）404/no-store，先于环境读取和数据库连接。
- 入口测试先因文件不存在失败；实现后资产/身份聚焦 47 项通过。尚未发布到云端，不能把本地休眠行为称为生产验证。
- 仍待更完整历史异常投影、测试 schema 清理对账、CI 浏览器接入与最终全量工程验收。
