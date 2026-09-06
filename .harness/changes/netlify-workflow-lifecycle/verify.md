# 04E 验证记录

## 2026-09-06 完整治理验收（优先于下方首片历史）

范围：八条 Workflow 治理路由及两个审核只读目录，Python/TypeScript/同库浏览器。
生产 `netlify.toml` 的 `/api/*` 仍指向 Zeabur；`workflows.mts` 无公开 path，直接 Function URL 在环境/数据库访问前404。
没有提交、推送、远程CI、模型调用、生产数据迁移或切流。

### 已复现并修复

- 草稿创建成功仍停留 `/new`，刷新丢失目标：独立保存、发布成功、校验失败、校验HTTP失败、发布HTTP失败均有 deferred RED/GREEN。
  保存成功后进入真实ID，后续保存PATCH；发布成功但历史读取失败只重试GET，不重复发布。
- 初始化目录加载期间编辑被异步重置：加载完成前不挂载编辑器；Workspace/Workflow切换后迟到响应隔离。
- `mappings:null` 原来校验放过，新增目标断言 `[]` 与预期错误数组不符；修复后与Python一致。
- Rubric引用字段带空格可发布却历史409：实际PG HTTP复现，双方只规范化查询标识、不改写原始快照。
- 损坏Data Object源版本快照原来Python仍201：对象/定义ID/Schema形状检查后409，零新增版本/审计。
- 既存版本内嵌Data Object快照损坏原来GET200：双方改为409，正常快照及省略嵌入snapshot的旧引用兼容。
- Human异常分配数组原来TS发布201而Python422；非字符串显式拒绝。错误顺序及Unicode整数也用真实共享HTTP RED/GREEN对齐。
- 界面截图发现工具栏文字竖排挤压，局部CSS换行/禁止按钮断词；最终截图人工查看通过。

### 实际数据库与共享契约

`node --experimental-transform-types scripts/test-workflows-postgres.mjs 55432 apps/api/.venv/Scripts/python.exe`
最终202项检查、56个Python/TS完整HTTP响应逐项一致。真实登录、角色/权限/CSRF/跨空间拒绝，
草稿完整更新、图/映射、三类固定版本引用、人审目录/门限/SLA、两版本不可变、软删除后历史、
审计故障无半版本、损坏历史/源快照/嵌入快照409、旧版本号冲突409均通过。
共享fixture固定业务ID，只归一生成ID和时间；不通过清空错误数组或仅比较字段名掩盖差异。
测试阶段之间仅清除随机schema内的限流计数，产品限流未关闭；零WorkflowRun/HumanTask。

`node --experimental-transform-types scripts/test-workflows-races-postgres.mjs 55432`
44项检查、6组 `pg_blocking_pids` 实际观察：HTTP发布/发布、发布/PATCH、发布/DELETE；
SQL AgentVersion修改、Data Object停用、Provider停用与HTTP发布竞争，后续发布422。
另验证update/delete审计失败后整行、时间戳及审计数量回滚；依赖写方为SQL，不冒称全部资产管理HTTP组合。

`scripts/test-workflows-python-postgres.py` 最新定向复验exit0、5.05秒：两个HTTP发布、编辑/删除锁、
依赖更新阻塞、固定快照、四条审计；所有上述随机schema均独立确认清理。
本机系统Python3.14有psycopg，命令为
`python -c "import sys,runpy; sys.path.append(r'D:\project\安克知识沉淀\apps\api\.venv\Lib\site-packages'); sys.argv=['scripts/test-workflows-python-postgres.py','55432']; runpy.run_path(sys.argv[0],run_name='__main__')"`。
不是CI Python3.12执行证明；共享HTTP使用项目Python3.12，CI使用已声明的postgres依赖。

身份及04A–D本轮重新通过：identity129、reference-assets198、Agent232、DataObject62、Rubric161、feedback139。
identity脚本参数为 `apps/api/.venv/Scripts/python.exe 55432`，其余为 `55432 apps/api/.venv/Scripts/python.exe`。
首次误用默认Python或5432导致缺依赖/连接失败已纠正，不算通过证据。

### 回归与浏览器

- 后端全量基线629项通过，Session1695，766.25秒；包含源快照拒绝、Rubric空白、人审与限流测试时钟修正。
  命令：项目Python `-m pytest apps/api/tests -q -o addopts='' -p no:cacheprovider --basetemp=.scratch/workflow-full-python-20260906-0143 --tb=short`。
  该轮启动后新增的既存嵌入快照保护另有定向7项通过（11.82秒），不得称最后代码一次全量629。
- 前端完整页面54项通过。最终 `npm test -- --run --maxWorkers=2 --no-file-parallelism`：62文件656项通过，Session95574，123.58秒。
  此前并行末轮Observability单项5000ms超时，改用CI已有串行文件策略后通过；未改产品/断言/超时，不将一次通过称作间歇worker问题根因修复。
- 最终浏览器Session13959：9条全部通过、35.2秒，随机schema清理确认。
  `ARC_ONE_TEST_PG_PORT=55432 node node_modules/@playwright/test/cli.js test --config=playwright.reference-assets.config.ts`。
  工作流通过UI重命名/Agent绑定/连线映射/保存后真实ID刷新/两次发布；HTTP读取确认旧版本名称与映射不变，运行按钮禁用、零外呼。
  水平SVG边包围盒高度为0，测试改为真实点击可见笔画中点，不以强制事件跳过实际操作。
- lint、Netlify typecheck、生产构建及deploy:check通过；既有大chunk提示保留。构建未发布。
- 全量最初发现旧Human夹具先发布后激活审核人，改为发布前激活合成选中条目；不改变生产Seed。
  旧限流测试固定60秒却可能跨半秒返回59，只固定测试monotonic，不放宽断言或产品规则。

### 清理与边界

本轮27个已用完的合成pytest/HTTP临时目录已删除，可重跑测试生成；源码、docs、fixtures和最终截图保留。
Docker启动时失效通信socket目录采用可恢复重命名，新通信目录恢复后启动原有本地测试容器；无业务卷删除。
Windows恢复备份目录保留以便回退，没有把Docker恢复当云端部署。
TS发布锁定同Workspace依赖目录，可能扩大竞争范围；本轮证明列出的竞争，不穷举所有混合事务或生产容量。
静态对象路径检查不保证运行时字段存在，不提供完整JSONPath/Schema执行器。
Node本机25、CI24，远程CI未运行；完成状态只允许本地工程ready-for-human，不代表企业生产版。

---

## 2026-09-06 范围确认与目录第一片

用户明确同意提前迁移审核人/审核组只读目录，设计及Issue已更新；无生产操作授权扩展。
coding-skill-python含未渲染FRAMEWORK_DESC占位符，未执行模板，按仓库真实Python/React测试流程处理。

### RED/GREEN

- 新 `test_workflow_migration_contract.py` 通过实际HTTP读取同空间组：合成坏关联指向外空间Reviewer。
  RED返回foreign/local而非local，证明姓名泄露；补list_groups与group_reviewer_ids的Reviewer.workspace_id条件后GREEN。
  第一次sandbox临时目录PermissionError不算业务RED；另用新basetemp批准后取得上述实际断言RED。
- TS十条治理/目录路由测试先因模块缺失失败，再新增route resolver后20项通过。
  PG目录测试先缺handler/directory模块失败，新增只读身份事务实现后17项通过。
  两者均是实现缺失红灯，不冒称先复现TS业务缺陷。

### 新证据

- Python目录/人工任务：17项，22.52秒，Session66930终态0。
  命令：`apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_workflow_migration_contract.py apps/api/tests/test_human_task_api.py -q -o addopts='' -p no:cacheprovider --basetemp=.scratch/workflow-directory-green-20260906 --tb=short`。
- Python人工工作流/生命周期：24项，26.37秒，Session97470终态0；合成SQLite/FakeGateway，无真实模型。
  文件：test_human_workflow_execution.py、test_workflow_lifecycle_api.py；basetemp workflow-directory-regression-20260906。
- `node --experimental-transform-types scripts/test-workflows-postgres.mjs 55432`：17项，四角色目录完整投影/顺序/null/停用条目，
  非成员与失效成员拒绝、坏跨空间Reviewer过滤、目录写入404、零HumanTask/WorkflowRun；随机schema独立确认清理。
  使用@netlify/database自带pg、默认CI5432、loopback和连接/语句超时；已注册CI但未运行远程CI。
- 新HTTP防护5项：四种写入外Origin拒绝、保留只读validate POST/no-store；路由与HTTP共25项。
- `npm test -- --run`：62文件630项，18.34秒，Session54624终态0。
- lint/deploy:check通过；build含Netlify typecheck通过，既有大chunk提示保留。

### 限制与下个切片

本片没有改页面，没有浏览器新证据；04E目录尚未接入页面或公共Function。
`directory.ts`对工作流生命周期返回明确501，不代理旧服务；十条路径可解析不代表十接口已实现。
Python/TS当前分别验证相同目录投影，尚无完整自动跨语言HTTP重放；需后续共享fixture补齐。
Python源码已变化，旧591全量不再是本次修改后的证据；最终还需新全量与独立两轴审查。
下一片：真实工作流请求契约、固定字段错误/状态、草稿CRUD，再校验与发布；本片AC均不提前勾选。
无提交、推送、部署、生产路由/数据修改，04E仍coding。
