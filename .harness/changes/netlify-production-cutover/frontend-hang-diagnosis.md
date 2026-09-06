# 本地 Vitest 卡死：独立有界诊断

日期：2026-09-06。范围：未改产品实现/配置；初始只读诊断后按主线程授权新增一个临时导航诊断测试，
主线程已接手转正式TDD，要求保留该文件。未连接生产，未重复全量验证。

## 结论

1. 找到并向主线程报告一个确定的本次遗漏：`scripts/reference-assets.test.mjs:22` 仍将
   `test-invocations` 归入未开放路由。旧断言稳定失败（24 pass/1 fail），主线程已按新契约修正。
   修正后的本审查组合运行包含该文件并通过。**这个普通断言失败不能解释 CPU 卡死。**
2. 原始 `--shard=3/8` 的卡死症状独立复现一次：verbose 最后完成记录是
   `Observability > shows troubleshooting guidance for dead-letter execution jobs`，随后至40秒上限无输出。
   所以定位到 **Observability 执行期间/其紧邻测试间隙**，但 reporter 可能缓冲结果，
   不能把最后一条输出后的第7例直接认定为根因。
3. 初始profile未取得原始卡死CPU栈；随后对真实Observability控制导航提交次序，
   **两次稳定复现双向状态同步的无限导航振荡**，护栏于约375ms内捕获21次交替URL写入，
   调用栈直接指向 `Observability.tsx:458` → `:262`。这是已证实的产品代码缺陷；
   但不能声称采集到了之前7分钟卡死的同一CPU栈，或证明它是此前所有卡死的唯一来源。
4. 主线程随后修复上述导航状态与独立证实的详情迟到缺陷；本审查独立验证 **14/14 GREEN**
   （新导航/详情2例 + 原Observability12例，4.32s），两条具体缺陷均有RED→GREEN。
   这关闭了已证实路径，不将“全部历史非确定性卡死均根治”作为结论。

## 分片与隔离证据

已读取当前安装的 Vitest 4.1.9 `BaseSequencer.shard`：相对文件路径带前导 `/` 计算 SHA1，
排序后平均分段。70文件的3/8为索引18—26，共9文件：

- `src/pages/Runs.test.tsx`
- `scripts/reference-assets.test.mjs`
- `src/pages/Login.test.tsx`
- `src/pages/Observability.test.tsx`
- `scripts/data-objects.test.mjs`
- `src/pages/Evaluations.test.tsx`
- `scripts/netlify-platform-workload.test.mjs`
- `src/components/OperationProgress.test.tsx`
- `src/pages/Schedules.test.tsx`

`vitest list --filesOnly --shard=3/8` 在当前版本实际列全70文件，不能作为9文件分片证据。
后续使用真实 `run --shard=3/8`，确认实际执行文件集合一致。

| 探测 | 结果 |
| --- | --- |
| 每个候选文件独立线程池执行，上限20秒 | 其余文件快速通过；reference-assets精确断言失败，无超时 |
| 同9文件显式列表，threads、1worker、verbose，上限35秒 | 9 files/120 tests pass，14.53s |
| 只变pool为forks，同9文件列表、1worker、verbose，上限35秒 | 9 files/120 tests pass，15.31s；否定“只要forks就卡死” |
| 原始 `run --maxWorkers=1 --no-file-parallelism --shard=3/8 --reporter=verbose`，40秒 | Evaluations16例已通过；Observability前6例输出后无进展，触及上限 |
| 第7例 `highlights expired worker leases`，5个独立进程、每次12秒上限 | 5/5 pass，单用例约200—227ms |
| 第8例 `loads another run detail`，8个独立进程、每次8秒上限 | 8/8 pass，单用例约183—212ms |
| 原始3/8增加V8 tick profiler，30秒上限 | 未复现；9 files/120 tests pass，21.99s。因此没有失败栈可供归责 |

这些探测使用线程池时，超时会结束自己创建的诊断进程；forks有界包装只针对自己创建的PID树。
40秒那次清理器因 `taskkill` 不在PATH而报ENOENT；会话结束后已用CIM确认自有PID20908及其子进程
不存在。随后改用已验证存在的绝对路径 `C:/Windows/System32/taskkill.exe`，但后续运行正常退出，
没有触发终止。未停止主线程进程。9份成功运行生成的临时V8日志已在确认目录和文件模式后删除；
没有删除用户文件，也没有留下失败profile却声称已分析。

## 最初源码候选与后续验证

当前扫描没有找到这9文件触发全库递归文件扫描/灾难性正则的证据；Tool新代码也不在
Observability页面的执行路径上。不能据此排除任何所有潜在库问题，只能排除本轮所查路径。

具体可证伪候选：`src/pages/Observability.tsx:444` 的effect根据requestedRunId设置selectedRunId，
`:455` 的effect又根据selectedRunId写URL；`:695`附近点击事件同时更改本地选择与Router参数。
如果Router导航尚未提交而本地选择先变化，两套状态可能互相恢复旧值。最初这是未证实假设；
第8例8次独立通过不足以证明或否定它。以下确定性实验将这一具体路径提升为已证实缺陷。

### 确定性导航实验：RED→GREEN

实验初始文件：`src/pages/Observability.navigation-diagnostic.test.tsx`，后按主线程指令整理为正式
`src/pages/Observability.navigation.test.tsx`。未改真实Observability或Router实现。
旧测试的9个fixture常量原样移至 `src/test/fixtures/observability.ts` 并export，原文件改为import；
内容对照HEAD常量区验证仅新增export，无数据变化。正式导航测试移除node:fs、Function和console，
直接导入fixture，保留排队提交、先旧后新交付与20次护栏。

Mock接缝：保留真实React Router模块、MemoryRouter和useSearchParams读取，只包装setter，
在测试控制的hold阶段排队导航提交函数，解除hold后调用真实setter。真实页面、React effect、
网络DTO消费和DOM均参与。最初fixture曾临时从既有测试纯常量区截取，现已按上述方式移除动态解析。
21次导航时抛出 `Navigation must converge within 20 writes`，避免真正拖死worker。

对照实验（GREEN）：初始URL已经有 `runId=run-failed`，默认导航不存在；暂缓用户新选择导航，
再提交最新 `run-waiting`。仅2次同向写入，最终URL与选中项一致，214ms通过。

变化实验（RED，唯一实质改变是允许旧默认导航晚到）：

1. 初始URL无runId，开始hold；实际页面加载默认选中run-failed并请求自动导航，暂不提交。
2. 等实际详情与最近运行列表可见，用户点击run-waiting；本地选中已改变，新URL写入也排队。
3. 此时写入请求是 `[run-failed, run-waiting, run-waiting]`。
4. 解除hold，先把最早的默认run-failed导航送到真实Router；计划随后再交付最新用户导航。
5. 旧实现无法走到下一步：URL→local effect与local→URL effect反复把上一渲染的对方值写回，
   后续请求连续 `run-waiting,run-failed,run-waiting,run-failed,...`，超过20次抛
   `DIAGNOSTIC_NAVIGATION_OSCILLATION`。

两次独立运行均RED：首次374ms；补交替日志、保留后续最新导航交付步骤后375ms。
正式fixture/文件整理后第三次RED为349ms，错误仍来自同一20次护栏，调用栈仍为真实页面的相同行。
真实调用栈为 `Observability.tsx:458`（effect）→`:262`（setSearchParams）→测试setter护栏。
该实验控制的是异步导航交付次序，不声称React Router在所有运行都固定按此次序提交；
它证明页面自身不能收敛于一个允许的旧导航迟到场景。没有用模拟函数替换被审查的选择逻辑。

### 最小修复建议及复审边界

优先以URL为唯一选择源，从filteredRuns派生默认显示，避免自动默认导航与本地镜像状态竞争。
点击已有显式writeSearchParams，不需再由effect回写有效URL。实施前核对现有默认URL补齐契约，
若保留补齐，也须给初始补齐与用户导航一个明确的所有权/过期判定，不能保留双向无限回写。
此外原 `getObservabilityRunDetail(...).then(setDetail)` 缺少过期请求边界值得独立验证；
它不是上述振荡实验的必要条件。随后按主线程明确分工补了独立详情迟到回归：
先悬置run-failed详情，选择run-waiting并确认CURRENT_RUN_DETAIL可见，再释放旧成功响应。
**在产品尚无详情guard时取得独立RED：209ms，URL仍run-waiting但DOM出现PREVIOUS_RUN_DETAIL**，
`Observability.navigation.test.tsx:79` 的不可见断言失败。
因此详情串线现也有独立因果证据，不能把它只归为导航振荡副作用。

主线程负责新设计/Issue、正式回归、最小实现和原分片复验；审查者转独立复审，不改产品。
临时文件当前会增加Vitest集合一个文件，主线程已知悉；完成改名/清理前不能沿用原70文件
分片清单作为最终完整门禁。不要仅增加分片、提高内存、删用例或放宽超时来宣称修复。

## 修复后独立复核（2026-09-06 17:48）

主线程删除selectedRunId镜像state与URL→state effect，改为从有效可见URL运行派生选择，
缺失/无效runId仍派生风险首项/过滤首项并规范化URL。显式点击只写URL，旧有效URL到达时
不会再被上一帧本地选择反向覆盖。详情effect在选择或Workspace变化时清理上次current，
then/catch/finally均检查同一生命周期守卫；新请求重置详情与错误，空选择结束loading。

本审查运行：
`node node_modules/vitest/vitest.mjs run src/pages/Observability.navigation.test.tsx src/pages/Observability.test.tsx --pool=threads --maxWorkers=1 --no-file-parallelism --reporter=verbose`。
外层仍用25秒上限防止诊断进程再次失控，未触及上限。

- 新导航竞争：旧产品正式RED349ms，修复后GREEN215ms。
- 新旧详情迟到：旧产品RED209ms、旧正文覆盖新运行，修复后GREEN94ms。
- 原12例均GREEN，包括默认展示、风险/状态/工作流筛选、URL/nodeRunId、队列操作与真实页面跳转。
- 合计2文件14例，4.32s。未改pool/时间限制作为产品修复；实际消除了双向同步，新增了详情守卫。

正式文件已确定为 `Observability.navigation.test.tsx`，总测试集合新增1文件，主线程负责重新计算完整分片。
独立简短评审见 `observability-navigation-review.md`；lint/build与全片/浏览器证据以主线程回执为准。

仓库已有相关历史记录：
`docs/superpowers/specs/2026-08-13-ci-vitest-worker-isolation-design.md:5`、
`.harness/changes/netlify-runtime-closure/verify.md:46`。
它们证明该文件的类似症状早于本次Tool切片，不证明具体根因，也不代替本次失败证据。
