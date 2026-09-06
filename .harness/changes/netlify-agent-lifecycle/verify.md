# 04B 本地实施回执

状态：coding，尚未完成 04B；用户已确认设计，不再等待同一确认。

## 本轮 RED/GREEN

- 状态：旧实现两个目标断言失败；发布写“在线”、停用写“已停用”后通过。
  新增旧乱码/正常停用两组拒绝编辑和发布检查，独立 Session 确认历史快照未改写；生命周期 7 项通过。
- 空值：新测试初始 13 failed / 1 passed（合法解绑已通过）。AgentUpdate 非空字段显式 null
  在字段校验前拒绝，modelProviderId null 保留；治理请求校验固定 422，不回显原 input。
  Agent 执行接口的错误契约未纳入这个处理分支。
- 地址：8 项测试初始 7 failed / 1 passed，证明数字别名、空 query/fragment 与模型 URL userinfo
  被错误接受。两类 URL 复用 04A 结构策略后拒绝；模型 URL 仍允许空字符串，不做 DNS 或请求。
- 原 `inspect-agent-contract-python.py` 再次执行退出 0：状态、全部非法 null 和 URL 边界符合目标；
  draft Provider 绑定、合法 null 解绑及复制配置保留均成立。

## 最新验证

`apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_agent_migration_security.py apps/api/tests/test_agent_lifecycle_api.py apps/api/tests/test_agents_api.py apps/api/tests/test_agent_api_gateway.py -q -o addopts='' -p no:cacheprovider --basetemp=.scratch/agent-url-green-20260905 -x --tb=short`

67 passed，44.84 秒，退出 0；1 条既有 Starlette 弃用警告。
`npm run lint`、`npm run build`（含 TS/Netlify 类型检查）、`npm run deploy:check` 均退出 0；
构建保留既有大 chunk 提示。本轮不是全量后端/前端回归，也没有声称浏览器或 PG 已验证 04B。

## 接续与边界

- 待完成：历史异常结构/类型与引用保护的完整对抗覆盖和最终审查。
- 已接入历史 URL/manifest 配置检查，但不能宣称旧 Agent 历史响应已全面脱敏或引用隔离验收完成。
- 无新增依赖、无 .env/密钥值读取、无生产数据库更改、无提交/推送/部署或 Zeabur 操作。
- 供应商技能仍有未渲染占位符；按项目实际规范与已确认计划执行，未覆盖技能目录。

## 历史配置与路由增量验证

- 历史 Agent/版本非法 URL、manifest：最初 4 项错误返回 200，加入只校验不改写的读取保护后通过。
- 历史非法配置的更新、停用、恢复和发布：最初 4 failed / 1 passed，加入响应前检查后通过。
  独立 Session 验证失败操作未更改 name/status/version；显式提交安全 URL 的修复仍允许。
- 旧 Python Package 发布断言从 422 调整为已确认的历史冲突 409，固定错误且原 manifest 保留。
- `apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_agent_migration_security.py apps/api/tests/test_agent_lifecycle_api.py apps/api/tests/test_agents_api.py apps/api/tests/test_agent_api_gateway.py -q -o addopts='' -p no:cacheprovider --basetemp=.scratch/agent-history-regression-20260905 -x --tb=short`：76 passed，52.79 秒，退出 0，既有弃用警告 1 条。
- `npm test -- --run scripts/agents.test.mjs --maxWorkers=2`：路由占位实现先 9 failed / 12 passed；最小实现后 21 passed。
  覆盖八条治理路由、未知动作、执行入口及非法路径；只是解析器，不是已可用的 Netlify Agent API。
- 本轮 `npm run lint`、`npm run build`（含 Netlify 类型检查）、`git diff --check` 均退出 0；保留既有 chunk/换行提示。
- 未运行本轮全量回归、Agent PG 或浏览器验收，未发布生产。04B 继续 coding。

## 请求防护与引用隔离增量

- 新 `agents/handler.ts` 复用身份 HTTP 边界；五类写路由 Origin 测试先 5 failed / 25 passed，
  最小接入后 Agent 30 项通过，与既有资产 HTTP 测试合跑 53 项通过。
  Session/CSRF 仅传给后台验证，不把参数传递测试称为真实身份授权验收。
- Python 历史 Provider/Tool/Skill 引用缺失或跨 Workspace 的列表/详情/版本读取，先 12 项错误返回 200；
  加入只读归属检查后拒绝。独立 Session 确认原引用不改写；同空间已停用资产额外 6 项读取通过。
- 历史失效 Provider 的编辑、停用、恢复、发布先 4 项失败；响应前检查后固定 409，
  独立 Session 确认 Agent 字段不变、无新增版本和审计。有效新绑定仍走原 404/422 规则。
- `apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_agent_migration_security.py apps/api/tests/test_agent_lifecycle_api.py apps/api/tests/test_agents_api.py apps/api/tests/test_agent_api_gateway.py -q -o addopts='' -p no:cacheprovider --basetemp=.scratch/agent-reference-write-green-20260905 -x --tb=short`：98 passed，74.77 秒，退出 0，既有弃用警告 1 条。
- `npm test -- --run scripts/agents.test.mjs scripts/reference-assets.test.mjs --maxWorkers=2`：53 passed；
  `npm run lint`、`npm run build`、`git diff --check` 退出 0，既有构建/换行提示保留。
- 对抗边界：这些证据不覆盖 PG 并发、类型错配全部组合、任意快照结构或完整 DLP；
  Agent Netlify 持久化和生产路由仍未接通，不宣称 04B 完成。

## PostgreSQL 创建与读取切片

- 新增 `agents/policy.ts`、`agents/postgres.ts`，复用身份事务、Session/CSRF、权限与审计。
  当前实现 create/list/get；PATCH、versions、publish、deactivate、activate 经权限检查后仍明确 501。
  尚无 Agent 生产 Function 入口，不改生产路由，不能称八条接口全部可用。
- `scripts/test-agents-postgres.mjs` 最初创建返回 501（目标 201），最小实现后通过。
  测试初版错误使用角色 observer，查证后修正为既有 viewer；未修改权限矩阵。
- PG 验证：独立连接池读到已提交 Agent、默认值/公开字段、列表与详情一致、CSRF/权限/跨空间隔离、
  审计插入故障回滚、draft Provider 绑定复制、disabled 新绑定拒绝但历史可读、非法输入固定错误、
  非法历史 URL/Provider 拒绝且不改写原数据。
- `fixtures/agent-create-requests.json` 与 `scripts/agent-create-contract-python.py` 重放 13 个实际创建请求。
  Python 拒绝整数参数字符串 `1e2`，TS 初版接受；根据 RED 修正数值解析，包含浮点下划线数字兼容。
  仅归一化随机 id 和时间，完整响应一致；不把创建契约等同于其他七条路由契约。
- `node --experimental-transform-types scripts/test-agents-postgres.mjs 55432 apps/api/.venv/Scripts/python.exe`：
  57 checks，13 shared create requests matched，退出 0；finally 独立查询确认本轮随机 schema 已移除。
  最初误用 strip-types 的启动失败发生在加载阶段，改用 CI 已有 transform-types 方式，不安装依赖。
- Agent/资产 HTTP 回归 53 项通过；lint、build（含 Netlify 类型）退出 0，既有 chunk 提示保留。
  本轮没有修改 Python 生产代码；未重新运行全量 Python、完整前端、身份/资产 PG 或浏览器。
- 接续：实现其余五条治理操作和版本/依赖锁，扩展共享契约、PG 并发与故障验收；
  历史引用形状/类型的完整对抗覆盖仍需补齐，然后接页面。九项总目标未完成。

## 八条治理操作与发布增量

- activate/deactivate、versions、update、publish 分别以真实 PG 501 失败开始，再加入最小实现。
  当前八条治理操作均有本地持久化实现，但没有 Agent Function 入口或生产路由，仍不是 04B 完整验收。
- 停用/恢复：权限、同空间查找、重复停用、无版本/有版本状态、原快照不变，审计失败时状态与更新时间回滚。
- 版本读取：核对 Python `VersionRead` 后移除初版多出的 agentId，响应严格为 id/version/snapshot/note/createdAt；
  非对象、非法 URL/manifest/Secret Ref、失效 Provider 快照固定 409，独立连接确认原 JSON 未改写。
- 编辑：缺省不改，Prompt 空格保留，12 个非空字段 null 拒绝，Provider 合法 null 解绑保留复制配置；
  Tool/Skill 稳定引用保留顺序与重复，依赖停用拒绝保存，显式移除依赖允许修复，两种停用状态均阻断编辑。
- 发布：Agent 行锁、Provider/Tool/Skill 固定顺序共享锁；生成发布前快照，版本/引用/状态/审计同事务。
  真实 PG 覆盖两次并发发布产生 v1.1.0/v1.2.0、审计故障无半版本、旧快照不变及计数候选冲突 409。
  对抗复核发现单 Session 更新会掩盖并发，已改用两个独立登录 Session，结果仍通过。
- `node --experimental-transform-types scripts/test-agents-postgres.mjs 55432 apps/api/.venv/Scripts/python.exe`：
  135 checks；13 个创建请求 + 11 个生命周期后续实际请求与 Python 完整响应匹配，退出 0；本轮随机 schema 清理确认通过。
- lint、build（含 Netlify 类型）退出 0；保留既有 chunk 警告。未重新运行本轮全量 Python/前端或身份/资产 PG。
- 未完成：发布与依赖停用的可控竞态测试、全角色/八路由矩阵、更多异常快照与绑定契约、入口/页面/浏览器、
  全量工程与对抗审查。未发布、未迁移真实数据、未关闭 Zeabur，不勾选完整 AC。

## 权限、依赖竞争与休眠入口

- 四角色 viewer/operator/builder/workspace_admin × 八路由，共 32 条真实 PG 权限检查通过。
  拒绝写入后独立连接验证目标 name/status/version/updated_at 不变；权限拒绝审计沿用身份层。
  初次列表 409 来自前一安全用例刻意损坏的合成引用；恢复该测试行后验证权限，不修改生产策略。
- `scripts/agent-dependency-race.mjs` 对 Provider/Tool/Skill 分别使用可控发布暂停点和另一 SQL 写连接。
  `pg_blocking_pids` 实际确认停用写连接被发布连接的依赖锁阻塞；发布先提交、停用随后完成；
  后续发布 422、无半版本且历史仍可读。该测试验证 SQL 依赖锁，停用写者不是另一个 HTTP 调用。
- 新 `netlify/functions/agents.mts` 无公开路径配置，直接 Function URL 在环境/数据库访问前 404。
  入口测试先因文件缺失失败，接入后 Agent/资产 HTTP 共 54 项通过；不把导入失败当成业务失败覆盖。
- `node --experimental-transform-types scripts/test-agents-postgres.mjs 55432 apps/api/.venv/Scripts/python.exe`：
  199 checks，roleRouteChecks 32，dependencyRaceTypes 3，13 创建 + 11 生命周期共享请求匹配，退出 0；本轮 schema 清理确认通过。
- `npm run lint`、`npm run build`、`npm run deploy:check` 退出 0；既有 chunk 警告保留。
  本轮未运行全量后端/前端、身份/资产 PG、浏览器，未推送或部署。
- 页面接入核查：AgentDetail 仍把 Provider/Tool 列表错误 catch 成空数组；testRun 仍可调用旧执行 API。
  下一步按已确认设计增加统一 Agent 迁移模式和显式依赖错误、按钮/事件双重运行隔离，再做同库浏览器。

## Agent 页面迁移模式

- `VITE_ARC_ONE_MIGRATION_MODE=agents` 使用同一能力入口，资产页沿用登记隔离；默认值未改变。
  Agent 列表和详情显示仅治理、运行尚未迁移的提示。
- 依赖失败不再在该模式中伪装为空数组：Provider 或 Tool/Skill 加载失败显示明确错误与重试入口，
  不显示可保存表单；非数组响应也拒绝。默认非迁移模式保留现有兼容行为。
- 测试运行按钮禁用且事件处理再次检查模式。测试特意保留已渲染的可点击按钮后切换测试环境模式，
  验证事件层仍未发出 test-runs 请求，而不是仅检查 disabled 属性。
- 上述四项页面测试最初全部失败；修复后通过。列表旧乱码在线状态最初漏计为 0，
  复用 displayStatus 后计数为 1；未改写数据库状态。
- `npm test -- --run src/pages/Agents.test.tsx src/pages/AgentDetail.test.tsx src/pages/AssetLibrary.test.tsx src/pages/ModelProviders.test.tsx --maxWorkers=2`：
  4 文件 34 项通过，15.36 秒；lint、build（含 Netlify 类型）、diff --check 退出 0。
- 未完成浏览器同库验收，也未运行本轮全量回归；下一步扩展隔离服务器与浏览器测试。
  不把组件测试等同于生产或真实浏览器完成。04B 继续 coding，生产路由未变。

## 同库浏览器与全量回归启动

- 隔离服务器增加 Agent 后端，共用身份/资产 PG；Vite 本地验证模式切到 agents，未知 API 仍 501，
  不代理旧服务。合成引用补齐实际字段；原引用计数保持，Agent 测试通过页面创建独立 Provider/Tool。
- 新 `e2e/agent-lifecycle.spec.ts` 实际登录→创建 Provider/Tool/Agent→绑定→保存→发布→改草稿→刷新读旧版本→停用→恢复。
  测试确认运行按钮禁用，无外域/test-runs/旧执行请求；刷新后旧版本名称与修改后的草稿名称同时可见。
- 初次失败证明隔离环境未接 Agent 模式；接入后修正过早匹配侧栏的选择器，以及新增数据导致旧资产审计全页匹配重复。
  使用真实 combobox 和目标资产 article 定位，没有降低业务断言或改产品文案迎合测试。
- `$env:ARC_ONE_TEST_PG_PORT='55432'; node node_modules/@playwright/test/cli.js test --config playwright.reference-assets.config.ts`：
  4 passed，12.2 秒，退出 0；独立 PG 查询确认本轮 schema 已清理。已查看保存的 agent-governance.png：
  隔离提示、在线状态、已编辑草稿、原版本名与备注可见；下方运行阻断由浏览器行为断言验证。
- CI 定义加入 Agent PG，现有浏览器步骤覆盖四条路径；未推送或运行远程 CI。
- `npm test -- --run --maxWorkers=2`：56 文件 436 项，52.80 秒，退出 0；既有 localstorage 警告。
- 身份 PG 129、资产 PG 198 再次通过；lint/build/deploy:check 退出 0，既有 chunk 警告保留。
- 全量后端已启动：`apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q -o addopts='' -p no:cacheprovider --basetemp=.scratch/agent-full-regression-20260905 -x --tb=short`。
  当前仍运行，未记录最终通过数量；不得用此前 98 项聚焦或 04A 全量替代结果。
- 最终审查待核实历史引用对象是否严格按响应字段投影，以及异常字段/类型是否统一受控；在核实前不标记 04B 完成。

## 全量结果与实时引用投影修复

- 审查确认 TS 实时 Agent 直接返回 toolAssetRefs/skillAssetRefs 原对象，与 Python AgentAssetRefRead 的字段过滤不一致。
  新 PG 测试先失败，证明合成 metadata.token 被额外回显；修复只投影五个契约字段，数据库原对象不改写。
  不将该修复解释成任意历史快照/自由文本的通用 DLP，也不声称异常字段类型已穷尽验证。
- Agent PG 全部重跑：202 checks，32 角色/路由、3 类依赖锁竞争、13+11 共享实际请求匹配，退出 0。
- 原全量后端进程正常完成，未重启：536 passed，418.21 秒，退出 0；既有 Starlette 弃用警告 1 条。
  命令与 basetemp 见上一节。本轮仅改 TS 投影，没有在该 Python 进程运行中改 Python 生产代码。
- 修复后全量前端再次运行：56 文件 436 passed，54.06 秒，退出 0，既有 localstorage 警告。
- 修复后四条浏览器再次运行：4 passed，15.6 秒，退出 0，独立 PG 确认本轮 schema 清理。
- lint、build（含 Netlify 类型）、diff --check 退出 0；既有 chunk/换行提示保留。
- 仍需核实历史引用必需字段缺失或类型错误的固定错误边界与新旧一致性；完成最终对抗审查之前，
  04B 保持 coding，不提交生产发布、不切流、不关闭 Zeabur。

## 历史引用必需字段收口

- Python 六项 RED 证明 assetName/status/adapterType 缺失或非字符串没有在历史保护中拒绝。
  TS PG 同样证明缺失字段错误返回 200。两端现在要求这三个既有契约字段为字符串，固定 409；
  不增加状态枚举限制，不修改自由文本，不清洗原引用。
- Python 测试同时检查纯保护函数和真实详情 HTTP 409；PG 检查固定错误与独立连接原数据不变。
- Python 相关四文件 104 passed，82.02 秒，退出 0；Agent PG 220 checks、32 权限路由、3 依赖竞争及24共享请求匹配。
- 浏览器四条重跑通过：4 passed，12.2 秒，schema 清理独立确认；lint/build 退出 0。
- 因 Python 生产校验发生变化，前节 536 全量是修复前基线，不能当作最新全量证据。
  新全量已启动：`apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q -o addopts='' -p no:cacheprovider --basetemp=.scratch/agent-shape-full-20260905 -x --tb=short`；
  前端 `npm test -- --run --maxWorkers=2` 也已启动，当前未结束，尚无新全量数量。
- 04B 仍待这轮全量结果和最终需求逐项审查；无生产路由、数据、发布、推送或 Zeabur 操作。

## 2026-09-05 最新全量回执

- 原后端 Session 32921 正常结束：542 passed，434.08 秒，退出 0；未重启该进程。
- 前端 Session 32417 的专用 worker PID 9480 持续 CPU 活动且长时间无输出，核实其 Vitest 路径后终止。
  首轮结果 55/56 文件、430/436 测试，1 个 worker 异常，退出 1；不得记为通过。
- `npm test -- --run --maxWorkers=2 --reporter=verbose` 重跑正常：56 文件 436 passed，53.37 秒，退出 0。
  没有为了重跑修改测试或生产前端代码；卡住的根因仍未知，不声称已修复间歇性运行问题。
- 本轮 lint、build、deploy:check、diff --check 通过；构建体积和换行提示保留。
- 后端 542 是进入 04C 新增 GET 之前的全量证据；04C 改动另有聚焦验证，不混报范围。
- 04B 尚未完成最终逐项审查，仍不标完整验收；没有生产发布、推送或关闭旧服务。

## 2026-09-05 最终审查后的创建与候选版本修复

- 创建请求空字符串/全空格 Provider ID 的两项测试先失败（201/404，而非固定 422）。
  初次修复校验误放 AgentUpdate，复跑仍失败；已移至 AgentCreate，保留合法 null 解绑及非空 ID 原值。
- Agent PG 重跑通过 222 checks、32 角色路由、3 类依赖竞争，15 创建+11生命周期共享请求匹配。
  该运行发生在下述 Python 候选版本修复之前；不代表 Python 的锁竞争验证。
- 新增候选冲突 RED：仅有 v1.1.0 的历史版本时，计数仍生成 v1.1.0，原实现错误返回 201。
  Python 发布现在检查同 Workspace/Agent/版本候选并返回与 TS 一致的固定 409。
  回归断言包括原 Agent、历史版本与审计均不变，不增加 schema 或自动治理历史。
- 空引用修复后的单文件测试 61 passed，61.02 秒；加入候选冲突后新一轮 62 passed，61.43 秒，退出 0。
  命令：`apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_agent_migration_security.py -q -o addopts='' -p no:cacheprovider --basetemp=.scratch/agent-security-candidate-green-20260905 --tb=short`。
- 本轮 lint、build（含 Netlify 类型）通过；保留已有大 chunk 警告。
- 两轴审查对 Python 锁保护是否属于本片范围解释不同：实施计划第2节将锁安排于 Netlify，
  设计则广义要求 Agent 写事务锁。确认 Python 仍无 Agent/依赖锁；本片保留未验收状态，
  下一步补明确的 Python 锁验证与保护。TS Promise.all 双发布不能证明真实临界区竞争。
- 原始 JSON timeoutSeconds 的 30.0/3e1 表示有双栈差异，未做原始 HTTP 兼容验证，保留评审待办。
- 没有生产发布、真实数据修改、推送或 Zeabur 操作。旧全量不能代替上述 Python 修改后的全量。

## Python Agent 行锁实测

- 新增 `scripts/test-agents-python-postgres.py`，固定 loopback、随机 schema、两个独立认证会话。
  RED 在 `first Agent publication did not acquire a row lock` 失败；finally 清理 schema 并由独立连接确认不存在。
- `find_agent` 增加仅写路径使用的 `for_update`，编辑/发布/停用/恢复启用；读取和执行接口不改。
  锁查询刷新 ORM 已加载对象，避免锁等待结束后继续使用旧状态。版本冲突检查仍单独保留。
- GREEN 已实际观察 `pg_blocking_pids`：第二次发布被第一次阻塞，释放后产生 v1.0.0、v1.1.0。
  独立 SQL 检查首版快照等于原 Agent；编辑/停用/恢复各观察到一次 FOR UPDATE，历史快照保持不变。
  后三条是锁语句执行证明，不冒充三条路径均完成并发竞争测试。
- 本地使用已安装系统 Python 3.14/psycopg，追加项目纯 Python 依赖搜索路径，与 04C 相同；
  不安装依赖、不修改环境、不读取凭证，不据此声称 CI Python 3.12 已通过。
- CI 定义加入脚本调用；未提交、推送或运行远程 CI。lint 通过。
- Python 安全及生命周期两文件回归：69 passed，67.89 秒，退出 0；
  basetemp `.scratch/agent-row-lock-regression-20260905`，保留既有 Starlette 警告。diff --check 通过。
- Provider/Tool/Skill 依赖锁尚未补齐；04B 继续 coding，不能以 Agent 行锁代替依赖停用竞态防护。

## Python 依赖锁与双轴复审（更新上述未完成项）

- 同一 PG 脚本增加 HTTP 发布/直接 SQL 停用竞争：先在 Provider 未阻塞处 RED；修复后 Provider 通过、
  Tool 未阻塞处 RED。Provider 显式共享锁与 Tool/Skill type+ID 顺序共享锁补齐后，三类全部 GREEN。
- 每类均观察 `pg_blocking_pids`，发布先持锁时停用必须等待提交；停用完成后再次发布 422，
  独立 SQL 确认只有一个版本，历史 GET 仍可读。竞争对手是 SQL 写入，不冒充完整 HTTP 停用路径验证。
- 创建/显式重新绑定 Provider 同样持共享锁；发布先锁 Provider，再按类型/ID 锁 Tool/Skill。
  未改执行接口、历史清洗或 Schema，仍保留名称数组顺序/重复和 Provider null 解绑语义。
- Spec/Standards 独立复审均确认此前三项锁/冲突缺陷修复，没有新增已证实阻断缺陷；
  原始 JSON timeoutSeconds 30.0/3e1 的双栈兼容差异仍待关闭，不把复审说成全部 AC 已通过。
- Agent TS/共享请求回归：222 checks、32 角色路由、3 类依赖竞争、15+11共享请求匹配，退出 0。
  build（含 Netlify 类型）通过，保留既有大 chunk 警告。
- 新全量后端进程 Session 5459 正在运行：
  `apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q -o addopts='' -p no:cacheprovider --basetemp=.scratch/agent-lock-full-20260905 -x --tb=short`。
  尚无完成结果，不重启、不以旧全量替代。相关四文件进程 Session 71565 已结束：92 passed，97.41 秒，退出 0。

## 原始 JSON 超时字面量证据

- `scripts/inspect-agent-timeout-python.py` 用合成身份、SQLite、原始 UTF-8 JSON 请求实测：
  30 → 201；30.0、3e1、30.5、true、字符串30、0、61 → 422。
- Agent PG 脚本末尾以原始 Request body 实测 Netlify Handler：30、30.0、3e1 → 201；
  30.5、true、字符串30、0、61 → 422。原有 222 检查继续通过；新增状态输出是诊断，不算契约断言。
- 数值差异确证，不再只据源码推断。已向用户询问是否统一接受整数数值并规范化存储；
  在用户选择前不改 Python 输入规则，不将本项标为通过。
- 迁移执行账本的旧 04B/04C 状态已刷新；04D 仍为 needs-triage，真实生产迁移未开始。

## 锁修复后全量终态

- 原 Session 5459 正常结束，未重启：562 passed，445.37 秒，退出 0；既有 Starlette 警告1条。
  命令/basetemp 见前文。该全量覆盖 Agent 行锁、候选冲突和依赖锁修复；没有修改超时输入规则。
- 本轮同时完成 04D 源码契约盘点，见 `docs/superpowers/specs/2026-09-05-netlify-rubric-sample-contract.md`。
  盘点不等于动态验证或迁移完成，未把依赖人工审核的样本确认简化为无来源登记。

## 确认等待期间的最后前端/浏览器回归

- `npm test -- --run --maxWorkers=2` 原 Session 24559 正常结束：57文件476测试通过，52.46秒，退出0。
  保留既有 localstorage 参数警告，没有重启或终止进程。
- `ARC_ONE_TEST_PG_PORT=55432` 的隔离 Playwright 五条路径通过，16.1秒，退出0：
  Provider、Tool、引用摘要、Agent生命周期和Data Object版本历史；schema删除经独立PG检查确认。
- 以上检查没有变更待确认的timeoutSeconds输入规则或04D设计，也没有真实外呼、发布、推送或生产切流。
  04B工程回归已取得最新证据，兼容选择仍待明确回复，不能将自动目标续跑视作该选择。

## 用户确认后：整数数值超时规则

- 用户明确回复“接受”，确认30.0/3e1按整数30处理及04D设计；此前等待确认项解除。
- 原始HTTP脚本新增期望断言与独立会话落库类型断言，RED在30.0返回422失败。
  normalize_agent_runtime_manifest 现在接受1–60范围内整数值int/float，返回int；bool/字符串/非整数仍拒绝。
  不主动重写历史记录，不改变1–60范围或外呼策略。
- Agent PG脚本现在直接比较两端8个原始JSON字面量结果，不再仅输出诊断：232 checks通过，
  32角色路由、3类TS依赖竞争、15+11共享请求通过。Python脚本断言成功值落库确实为int30。
- Agent接口/本地运行/迁移安全三个文件：90 passed，107.01秒，退出0；
  basetemp `.scratch/agent-timeout-integer-values-20260905`。lint通过。
- 此次生产校验代码变化后仍需最终全量验收，旧562全量仅是变化前基线，不提前标04B整体完成。

## 2026-09-05 最终收尾（覆盖上方待审状态）

- 独立Spec审查复现跨Agent晚响应覆盖表单，Workspace/Agent key隔离RED/GREEN通过。
  与量规页最终聚焦35项通过（Session76176，15.47秒）；独立复核结论见review.md。
- 主线程重新执行 `node --experimental-transform-types scripts/test-agents-postgres.mjs 55432 apps/api/.venv/Scripts/python.exe`：232项，6.57秒。
  身份129、资产198、Data Object62、量规161、候选139也复跑通过；各脚本随机schema隔离。
- `npm test -- --run` 最终Session57279：61文件605项，19.83秒。
  前次Session13957为604通过/1失败，旧Reviews复制成功提示使用同步断言，改成等待同一提示后聚焦19项及全量通过。
  不把该测试异步等待修正冒称业务逻辑修复或以前worker卡顿根因修复。
- `$env:ARC_ONE_TEST_PG_PORT='55432'; node node_modules/@playwright/test/cli.js test --config=playwright.reference-assets.config.ts`
  最终Session87155：8条全部通过，29.7秒；schema独立确认清理。
- lint、deploy:check、build（含Netlify typecheck）最终退出0，既有大chunk提示保留。
  Python当前全量591项来自此前本轮Session39319，613秒，此后未改Python源码；不是又一次新跑的Python全量。
- 04B本地工程ready-for-human；未提交、推送、部署或切流，模型/执行及生产迁移不在验收结论中。
