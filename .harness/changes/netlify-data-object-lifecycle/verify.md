# 04C 本地验证回执

## 2026-09-05 历史读取最小切片

- 用户确认五接口设计，已形成计划与 coding 需求卡。
- RED：新增历史读取用例在 GET /versions 处因 404 != 200 失败，1 failed；
  首次未指定 basetemp 的运行因系统临时目录权限失败，不算行为 RED。
- GREEN：补只读 GET，复用 asset.read、Workspace 上下文和定义作用域；7 passed，7.93 秒。
- 下一轮 RED：损坏历史快照为数组时抛响应校验异常，schema 为数组或缺失时错误返回 200；3 failed。
- GREEN：固定 409，不回显或改写损坏值；全部 Data Object API 测试 11 passed，11.44 秒。
  包含空历史、两次发布倒序返回完整响应、独立 Session 对比冻结快照、跨空间定义/版本过滤、未认证 401。
- 命令：`apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_data_object_definitions_api.py -q -o addopts='' -p no:cacheprovider --basetemp=.scratch/data-object-invalid-green-20260905 --tb=short`。
- lint、build（含 Netlify 类型）、deploy:check、diff --check 通过；既有 Starlette 弃用和构建体积警告未消除。

## 对抗检查与未完成项

- 不把定义不存在包装为空列表；先查当前空间定义，版本查询同时约束 workspace_id/definition_id。
- 不使用当前草稿重建历史；只读持久化 snapshot，损坏内容保持原值供治理。
- 当前历史保护只保证 snapshot/schema 对象结构，不是完整 JSON Schema 标准验证或通用 DLP。
- 新 GET 尚无四角色专用矩阵；其余四路由固定错误与竞争保护、TS/PG 对等实现、页面、浏览器、新全量仍待完成。
- 04B 后端 542 全量早于本轮 Python 变更，不作为本轮全量结果。
- 未接公共 Function、未更新生产代理、未推送/部署/迁移真实数据。04C 保持 coding。

## TypeScript 五路由与 PostgreSQL 首轮

- 新增 routes/handler/policy/postgres 模块及休眠 data-objects.mts，复用身份事务、CSRF、Origin、权限与审计。
  不配置公共 path，直接 Function URL 在读取环境或数据库之前 404；遵循 Netlify Functions 入口结构。
- 路由/请求/入口测试与 PG 脚本先写并运行，最初因目标模块不存在而加载失败；这是结构缺失证据，
  不是各业务分支曾独立失败的充分证据，后续契约重放和对抗验证仍需补足。
- `npm test -- --run scripts/data-objects.test.mjs --maxWorkers=1`：38 passed，退出 0。
  覆盖五路由、越界路径、Schema 别名/双别名拒绝、extra=forbid、长度/null、Origin、认证参数传递和休眠入口。
- Python 固定错误新增两项先失败（原始请求被包含在 Pydantic detail 中）；限定 Data Object 路径后，
  全部相关 API 13 passed，13.46 秒，退出 0，临时目录 `.scratch/data-object-errors-green-20260905`。
- `node --experimental-transform-types scripts/test-data-objects-postgres.mjs 55432`：61 checks、20 roleRouteChecks，退出 0。
  同库登录、CSRF、四角色五路由、历史冻结、独立连接验证、两 Session 并发发布、唯一名称竞争、
  候选版本冲突、创建/编辑/发布审计回滚、失效成员和损坏历史不改写均通过。
  独立连接确认本轮随机 schema 删除；仅测试合成数据。
- 成员失效测试最初错误期待 403，实际 404；核实共享 workspaceContext 有意隐藏 Workspace 存在性后改为 404，
  未改身份实现以迎合测试，亦不将该失败当作生产缺陷修复。
- lint、build（含 Netlify 类型）、deploy:check 通过；diff --check 通过但有既有换行提示。
- 尚未完成 Python/TS 实际共享请求重放，Python 原四路由竞争/历史异常对等修复、页面/浏览器、CI 接入和新全量仍待继续。
  61 项 PG 检查不是生产验收；04B 的最终审查也仍未结束。

## 新全量回归已启动（尚无最终结果）

- 前端 `npm test -- --run --maxWorkers=2 --reporter=verbose`，Session 56767，已输出测试进度，仍运行。
- 后端 `apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q -o addopts='' -p no:cacheprovider --basetemp=.scratch/data-object-full-20260905 -x --tb=short`，
  Session 72331，已输出进度，仍运行。应继续查询同一进程，不因观察超时重启。

## 共享契约、可达页面与浏览器闭环

- 前节原进程正常结束：前端 57 文件 474 passed，52.82 秒；后端 549 passed，429.69 秒，退出 0。
  该前端全量早于下面页面改动，不作为最终页面全量证据；本轮没有在后端运行期间修改 Python 业务代码。
- 新 `fixtures/data-object-requests.json`、`scripts/data-object-contract-python.py` 重放真实 HTTP；
  系统 ID 按一致映射规范化，时间规范化，Schema 原文不处理，包含同名 id/createdAt 属性保护。
- 首次对比失败定位为 Windows Python stdin 默认编码改变中文请求，重放脚本显式 UTF-8 解码后：
  PG 62 checks、20角色路由、12创建+11后续请求完整响应匹配；合成 schema 独立确认清理。
  该修复属于验证工具，不能描述为业务中文存储缺陷修复。
- 页面测试先因找不到历史入口失败；新增 API 封装、只读历史组件、显式 data-objects 迁移模式、失败重试。
  该模式包含此前 Agent/资产治理与执行阻断，不改变默认生产模式。
- 浏览器 RED 发现现有 DataObjects 从未注册 App 路由；补迁移模式专用 `/w/:workspaceSlug/settings/data-objects`
  和 asset.read 导航。隔离同库服务器接入五路由，未知接口仍 501，不代理旧服务。
- 同库浏览器五条路径 5 passed（16.3 秒）；补发布刷新结果提示后再次 5 passed（14.6 秒）。
  新路径实际登录→导航→创建→发布→修改Schema→再发布→刷新→读取两版，旧快照未变且只读，无外域/执行请求。
- 组件测试进一步 RED 证明“发布已提交但列表刷新失败”缺少明确说明；修复后五个迁移页面共39项通过，15.28秒。
  UI 保留已提交版本号，提示“版本已发布，但定义列表刷新失败”，不引导重复发布。
- 已查看历史截图：避免沿用编辑表单的双列和 page-stack 居中收缩，增加专用完整宽度样式；
  只读历史区域截图包含 v1.1.0 revised 与 v1.0.0 original。最后布局复核路径1 passed（7.0秒）。
  每轮浏览器均独立确认合成 schema 清理。
- lint/build/deploy:check 通过；CI 定义增加 Data Object PG，并纳入第五条浏览器路径，未推送或运行云端 CI。
- 最新前端全量 `npm test -- --run --maxWorkers=2 --reporter=verbose` Session 47466 已输出进度，仍运行。
  Python 原四路由的锁/冲突和异常历史保护对等审查、四角色Python专用矩阵、最终对抗审查仍待完成。
  04C 保持 coding，04B 最终审查也未关闭；没有生产部署或切流。

## Python 对等保护收口

- 前端原 Session 47466 已正常结束：57 文件 476 passed，51.90秒，退出0，包含历史页面与发布刷新提示。
- 版本候选冲突 RED：合成已有 v1.1.0 且计数为1，原 Python 发布仍201；加入存在性检查后409，
  独立 Session 确认没有新增版本/状态变化。编辑和发布现均申请定义行 FOR UPDATE。
- 异常草稿 Schema 的列表、编辑、发布三项先失败；发布异常明确为 DataObjectDefinitionRead 的 dict_type 校验。
  现在固定409且不回显，原始非法Schema、描述、版本保持；显式提交合法Schema仍允许治理修复。
- 创建/编辑唯一名称竞争通过注入真实 IntegrityError 类型验证错误映射，2项先失败；
  仅识别已知 PG constraint name 或精确 SQLite 唯一约束消息，回滚后409；其他约束不伪装为名称冲突。
  这是故障注入，不等同于 Python 实际双连接并发证明。
- Python 四角色/五路由矩阵验证通过，低权限业务数据不变；全部 Data Object API 23 passed，23.12秒，退出0。
  命令 basetemp 为 `.scratch/data-object-roles-green-20260905`。
- PG/共享实际请求重新通过：62 checks、20角色路由、12创建+11后续响应匹配；随机 schema 清理独立确认。
- lint/build/deploy:check/diff --check通过，既有构建体积/换行提示保留。
- 尚需 Python 实际PG锁与名称竞争验证（不能用SQLite替代）、最终逐项对抗审查。
  549后端全量早于本轮Python修复，已经启动新全量，未获得最终结果前不能宣称本轮全量通过。
- 新全量命令：`apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q -o addopts='' -p no:cacheprovider --basetemp=.scratch/data-object-hardening-full-20260905 -x --tb=short`；
  Session43920，已输出进度且仍运行，应继续查询同一进程。

## Python 实际 PostgreSQL 竞争证明

- 新 `scripts/test-data-objects-python-postgres.py` 限定 127.0.0.1 和随机 schema。
  两次真实登录得到不同 Session；首个 HTTP publish 获得定义锁后暂停，独立管理连接通过
  `pg_blocking_pids` 观察第二个 HTTP publish 被第一条连接阻塞。释放后两次201，版本分别v1.0.0/v1.1.0，
  独立SQL确认首版快照等于发布前定义。两会话重名创建结果201/409且仅一条持久化记录。
- 首次项目虚拟环境运行因缺少 psycopg 失败，系统Python直接运行因缺少 pydantic_settings 失败，均未执行数据库验证。
  未联网安装；用系统Python3.14.3的psycopg3.3.4与后备项目纯Python依赖路径完成隔离验证。
  命令：`python -c "import sys,runpy; sys.path.append(r'D:\project\安克知识沉淀\apps\api\.venv\Lib\site-packages'); sys.argv=['scripts/test-data-objects-python-postgres.py','55432']; runpy.run_path(sys.argv[0],run_name='__main__')"`。
  输出 passed=true、independentSessions=2、publicationLockObserved=true、versions=2、uniqueNameResults=[201,409]，退出0。
  该进程限定后备搜索路径，未修改系统/项目安装环境；独立确认本轮schema清理。
- CI Python3.12已有安装步骤增加项目声明的postgres extra，并加入同一脚本。尚未执行远程CI，
  本机替代环境通过不能描述为CI3.12已经通过。
- 复跑资产PG198、AgentPG220（含依赖竞争和共享请求）通过。身份PG首次参数位置错误连接5432失败，
  核实参数签名后 `node --experimental-transform-types scripts/test-identity-postgres.mjs apps/api/.venv/Scripts/python.exe 55432`
  129检查通过；未启动或操作5432服务。
- 最新lint/build/deploy:check/diff --check通过，既有构建体积和换行提示保留。
- expert-reviewer-python按仓库规则启动独立Spec/Standards审查，报告未收齐前不宣称评审通过。

## 最终本地回执

- 原Session43920正常完成：559 passed，435.07秒，退出0，既有Starlette弃用提示1条。
- 独立Spec与Standards评审均未发现已证实严重问题，主任务将回执补齐；详情见review.md。
- 按实际证据区分Python已观察发布锁、TS双Session请求结果、唯一约束故障注入；不声称所有竞争分支均被实际命中。
- 本地工程转verifying，Issue ready-for-human；全量迁移目标未完成，未提交/推送/部署或操作Zeabur。
