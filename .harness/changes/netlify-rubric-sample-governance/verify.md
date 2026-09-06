# 04D 本地实施证据

用户已明确接受设计。仅本地实现，无生产切流、真实模型调用或历史数据清洗。

## 固定校验错误

- 新3项RED：量规POST、量规PATCH、候选确认POST的无效请求回显了合成private-marker原输入。
- 复用现有 RequestValidationError 处理器，仅针对这三种路径/方法固定返回422：
  `量规或样本请求字段不符合要求`。不扩展到运行评分等未迁移路径。
- `test_rubric_migration_contract.py` 修复后4 passed，6.04秒，退出0；
  包含3项不回显断言和既有完整替换/快照特征测试。
  basetemp `.scratch/rubric-fixed-validation-green-20260905`；lint通过。
- 未覆盖损坏来源读取、锁竞争、样本事务与TS实现；这些保持未完成，不把校验错误修复算成04D验收。

## 候选来源读取保护

- 新测试用FakeGateway驱动合成审核生成真实持久化候选，分别模拟原版本、修改版本、diff缺失或跨空间。
  首个RED在列表读取抛未处理RuntimeError处失败，不是测试环境失败。
- 来源缺失现在抛专用 HumanTaskSourceConflict；仅候选列表/详情边界映射固定409，
  不捕获所有RuntimeError，不回显来源内容，不用空数组/空文本伪装成功，不自动修复原引用。
- 新6项断言同时检查列表/详情、源记录与引用不改写。与既有人工审核测试共同运行的
  Session 42179 已正常结束：22 passed，40.03秒，退出0；basetemp `.scratch/feedback-source-green-20260905`。
  lint通过，保留既有Starlette警告。
- 本轮开始时的全量 Session 3717 使用 `.scratch/post-acceptance-full-20260905`，仍在运行；
  它先于本次来源保护启动，结果不能用来证明新增来源保护全量通过。

## 全量发现旧响应断言冲突

- Session 3717 终态为失败：232 passed、1 failed，213.30秒，退出1。
  `test_rubric_validation_rejects_duplicate_dimension_ids_and_names`仍要求详细Pydantic错误文本，
  与用户已确认的固定422错误不一致。不能将本轮全量记为通过，也不为通过测试恢复原输入回显。

## 样本确认失败路径与旧断言同步

- 重复维度测试改断言固定422响应，继续覆盖重复ID与大小写/空白归一后的重复名称；
  新增独立会话查询确认这两条量规没有写入。单测1 passed，1.87秒，退出0。
- 新增修改版本、WorkflowRun、HumanTask各自缺失/跨空间的6种确认请求，首次RED均因旧乱码错误与
  固定中文契约不符而失败（原422拒绝已存在，不冒称新实现了来源隔离）。
  现固定返回“黄金样本来源不完整，需先完成治理”；断言无GoldenSample、候选状态/confirmedAt和审计不变。
- 数据库AuditEvent插入事件注入合成失败，用独立会话验证样本、候选状态和审计全部回滚。
  此测试首次即通过，证明现有原子性，不冒称是本轮修复；也不代表HTTP错误包装或PG并发已验收。
- 联合回归 Session 63302 正常结束：55 passed，73.10秒，退出0；范围为反馈来源安全、量规迁移契约、人工审核与评估四文件，
  basetemp `.scratch/rubric-sample-governance-regression-20260905`；lint、diff --check通过。

## 同候选并发确认：真实 PostgreSQL

- `create_task` 测试夹具增加可选数据库地址，默认SQLite不变；新PG脚本使用固定loopback、随机schema、
  FakeGateway生成完整运行/审核/产出物/候选链，再用同专家的两个独立登录Session并发确认。
- RED在`first confirmation did not acquire candidate lock`失败；精确schema已在finally清理并独立确认。
- 样本确认查询加入候选FOR UPDATE和populate_existing，不改变列表/详情读取或历史幂等返回。
  GREEN实际观察pg_blocking_pids；两个201完整响应相等，独立SQL核实只有1个样本、1条确认审计。
  不同键重复确认409。清理再次独立确认。
- 沿用已安装系统Python3.14/psycopg及项目纯Python依赖搜索路径，无安装/生产凭证；
  不据此声称CI Python3.12已运行。CI定义已加入脚本，尚未推送或远程运行。
- 相关回归Session18640正常结束：29 passed，43.21秒，退出0；basetemp `.scratch/feedback-lock-regression-20260905`。lint通过。
- 跨候选同键竞争、资格撤销/来源并发修改和TS实现仍未验收，不能由同候选测试推断这些保证。

## 资格撤销竞态

- PG脚本在资格检查之后、候选行锁之前设同步门，直接SQL分别停用User、停用Membership、取消Reviewer专家标志。
  首个RED证明users撤销未被确认阻塞；不是连接或夹具错误，随机schema已清理。
- `active_reviewer_for_user`增加仅确认入口启用的共享锁参数，固定User→Membership→Reviewer顺序，
  populate_existing刷新可能已被身份上下文缓存的对象；其他审核入口默认不启用该锁行为。
- 三类SQL撤销均通过pg_blocking_pids观察到被确认阻塞；本轮使用已存在样本的幂等确认重放，
  不能冒称同时覆盖首次创建全过程的撤权竞态。后续撤销生效时精确返回401/404/403。
- 首次GREEN检查阶段对Membership误期待401/403，实际404；这是既有Workspace不可见语义，
  已将断言修正为User401、Membership404、非专家403，再次全部通过，未放宽业务授权。
- 29项来源安全/既有审核回归通过，38.70秒，退出0；basetemp `.scratch/feedback-qualification-regression-20260905`。
  lint通过，PG测试schema独立确认清理。跨候选同键竞争、来源锁和TS迁移仍待完成。

## 跨候选幂等键唯一索引竞争

- PG脚本通过第二次Fake运行与人工修改生成第二个完整候选。独立SQL事务修改第一个样本的幂等键并暂不提交，
  第二个候选HTTP确认尝试使用同键；实际观察其INSERT被该唯一索引事务阻塞。
  SQL提交后首次RED抛出真实`uq_golden_sample_idempotency` UniqueViolation，证明缺少冲突HTTP映射。
- 仅在GoldenSample首次flush处捕获IntegrityError，且必须SQLSTATE23505和两条已知样本唯一约束之一；
  显式rollback后固定409“黄金样本确认冲突，请刷新后重试”。不吞其他数据库异常、不返回其他候选样本。
- 真PG GREEN：409固定响应、只有原样本、第二候选保持未确认、没有确认审计；精确测试schema已清理。
  对手是更新已有样本键的SQL事务，不把此证据描述为两个HTTP首次创建请求或跨Workspace竞争验证。
- 29项审核/来源回归通过，38.02秒；另4项注入约束边界测试通过，6.06秒：已知candidate约束映射409，
  未知约束、非23505及无诊断字段均继续抛错并无半样本。注入测试不是实际PG candidate唯一冲突证据。
- 来源记录共享锁、跨空间同键边界及完整TS实现仍待完成；当前全量尚未重新通过。

## 来源共享锁与 TS 量规 HTTP 接缝

- PG脚本增加三次独立首次确认。确认读取来源后、INSERT之前设置同步门；独立SQL连接分别对
  artifact_versions、workflow_runs、human_tasks执行同值UPDATE。首次RED明确为产出物写入未被阻塞，
  退出1、7.57秒，测试schema独立确认清理；不是连接失败或夹具失败。
- 确认路径仅对修改版本→运行→人工任务三条同空间来源查询加FOR SHARE和populate_existing。
  GREEN退出0、5.15秒：三类SQL写入均通过pg_blocking_pids观察等待确认事务；独立SQL核实输入、
  期望输出、已确认状态、confirmedAt及每次一条审计。保留既有幂等返回顺序，不给普通读取增加锁。
- 这里的对手是同值UPDATE，不是跨空间移动、删除或完整业务运行并发验证；所有运行由FakeGateway生成。
  create_task仅增加可选FakeGateway注入，原默认两条测试输出保持不变。无安装、生产数据或模型外呼。
- 来源/人工审核/量规四文件回归Session50785：59 passed，77.67秒，退出0。
- TS新增_shared/rubrics/routes.ts和handler.ts，六条治理路由及四种写操作Origin防护复用身份HTTP接缝。
  路由首次RED返回null；HTTP首次RED四种写操作错误返回200；实现后21项测试通过，类型检查通过。
  评分执行路径拒绝；会话与CSRF仅转交，并不声称已实现数据库授权。尚无量规TS存储、字段策略、
  Function入口或生产path，也没有新增前端页面。
- lint和build通过（构建保留既有大chunk提示）；新增TS文件后typecheck再次通过。
  本轮全部代码改动后lint/build再次通过。
- 后端全量Session68936正常结束：583 passed，488.61秒，退出0；命令为项目venv执行
  `pytest apps/api/tests -q -o addopts='' -p no:cacheprovider --basetemp=.scratch/feedback-source-full-20260905 -x --tb=short`。
  此结果包含已接受的Agent数值规则及量规固定错误契约，替代上一轮232 passed后失败的全量结果。
- 前端第一次全量Session25566异常：223.81秒，57/58文件、491/497项通过，未完整结束。
  只读核对worker17156属于本轮Vitest父进程40064，持续CPU206.58秒、内存约2.86GB；
  限定PID和命令行检查后停止该专用worker，测试退出1。未停止业务进程或删除数据。
  `npm test -- --run --reporter=verbose`重跑Session44076完整通过：58文件497项，18.06秒，退出0。
  首轮异常根因未查明，不得把后续通过解释成根因已修复；未修改测试断言或应用代码来绕过该异常。
- 对抗式自检：本轮仅确认Python锁行为和TS HTTP接缝，不将同值SQL竞争夸大为完整生产来源生命周期，
  不将HTTP转交凭据夸大为已实现授权。04D仍为coding，九路由PG/契约/页面及独立双轴终审未完成。

## TS字段契约、创建读取与默认初始化

- 新增policy.ts、casefold.ts、defaults.ts、postgres.ts以及共享fixtures/rubric-policy.json。
  字段解析首次RED为完整合法请求被422拒绝；随后与真实RubricWrite比较规范化结果，而非仅比较状态码。
  保留完整PATCH语义所需默认值、额外字段拒绝、嵌套维度额外字段忽略、别名冲突、权重/阈值及Unicode判重。
- 首轮显式预期误判字符串3_0，实际Python接受为30；据实修正预期和TS转换，不收缩Python已有契约。
  另一次真实RED发现数字字段错误接受U+001C；数字解析改用Unicode White_Space，文本继续匹配Python str.strip。
  当前63个共享JSON请求通过，含空值、整数值浮点、字符串、bool、非法数值、别名、维度及文本空白。
  这是schema级契约，不是63个双栈实际HTTP/数据库生命周期请求；后者仍待补齐。
- Unicode映射由项目Python3.12的Unicode15.0.0生成；独立重新计算全部1,114,112码点逐项比对通过。
  默认三量规通过AST literal_eval读取main.py的原始常量并完整对比，不导入应用、不读取.env、不改历史版本值。
- PG创建/读取首次RED为匿名请求501而非401；接入现有身份事务、CSRF、能力、Provider共享锁及成功审计后通过。
  默认首次读取另有RED 501，随后增加Workspace行锁、锁后重查和兼容三条默认记录。
  创建也锁Workspace，避免与初始化竞争并串行分配sort_order；不增加普通编辑反向取Workspace锁。
- 真实PG最终26项检查通过：创建/读取/默认值、缺失Provider拒绝无写入、viewer权限、CSRF、审计触发器失败回滚；
  两个独立登录Session的默认初始化通过pg_blocking_pids观察实际阻塞，返回相同ID、独立SQL仅三条记录。
  首次并发测试误用同Session，第二请求未到Workspace锁；改为独立Session后通过，不把夹具失败称作实现缺陷。
  schema每次在finally清理并用独立连接确认。本轮没有安装依赖、调用模型、生产写入或部署。
- 量规Vitest84项通过，最终PG脚本0.94秒退出0；63请求/Unicode/默认常量独立比较通过。
  lint无新增警告；build通过且保留既有chunk提示。CI已登记两条新脚本，但未推送或运行云端CI。
- 边界：当前PG仅创建/列表及默认初始化；编辑/发布/版本历史/停用返回明确501，未创建Function入口或生产path。
  Provider完整失败矩阵、历史读取边界、生命周期事务/版本竞争、候选TS与页面尚未验收。04D保持coding。
- 前端中间版本全量58文件557项通过（Session65470，17.54秒）；最后新增三项空白差异后，
  Session87590再次出现专用worker持续CPU137.88秒、约1.99GB内存且不结束。经PID/父进程/命令行核对后定点停止，
  最终57/58文件、554/560项，退出1、159.11秒，不计全量通过。
  现采用仓库CI既有八分片、每片独立Vitest进程及单worker方式重跑（Session69343）；未改变断言或跳过测试。
  尚未证明异常根因已修复；项目Python应用代码未在本轮变动，583项后端全量为上一轮证据。
- 分片1/2分别32、57项通过；第3片也出现worker持续CPU121.72秒、约2.17GB内存。
  定点核对并停止worker4652（父27296），Session69343退出1：第3片6/7文件、92/97项，137.83秒。
  因此分片本身不是已证实的修复。缓存及剩余用例把排查范围缩到Observability；其12项单文件详细回放通过，3.40秒。
  未修改Observability源码或断言；继续详细重放第3片及未执行的4–8片（Session19088），保留所有首次失败事实。
- 最终第3–8片分别97/136/27/48/82/81项通过，Session19088退出0；结合先前第1/2片32/57项，
  同一最终代码下八片共58文件560项均有通过证据。不是一次无失败的全量执行，也不是测试卡顿根因修复证明。
  lint/build、量规PG26项及63项schema/全Unicode/默认常量比较均通过；无测试进程仍在运行。

## TS量规六路由生命周期

- 版本历史首次RED为501，补同空间查量规、历史createdAt降序和固定损坏读取拒绝后通过；
  完整PATCH首次RED为501而非422，再补编辑/发布/停用事务。发布快照为active及新版本，DB快照使用Python snake_case，
  HTTP投影使用camelCase；后续编辑/停用不改历史。候选版本号冲突409且不激活草稿或新增版本。
- 首次停用测试误以为builder可操作，实际403符合既有能力表；保留此拒绝断言并切换合成workspace_admin完成200停用，
  没有为测试放宽权限。四角色六路由及四种写操作CSRF均通过，viewer/operator拒绝后无资产状态/版本写入。
- 新增fixtures/rubric-http.json和rubric-http-python.py：8个创建、17个后续请求对照实际Python HTTP与TS/PG完整响应，
  仅归一化动态资产/版本/Provider ID及时间戳，显式维度业务ID不归一化。覆盖完整PATCH、Provider解绑默认重置、
  发布/历史、停用后拒绝、缺失Provider/模型/criteria及数字别名，不触发真实评分。
- 共享请求新增真实RED：BOM模型/criteria在Python保留且可发布，JS trim误返回422；统一复用已验证Python strip后通过。
  这是兼容既有登记/发布规则，不证明BOM模型可调用或评分有意义；不擅自改写旧契约。
- PG通过两个独立登录Session实际观察量规FOR UPDATE等待；依次生成v1.0.0/v1.1.0及对应active快照，独立SQL两版本/两审计。
  独立SQL停用Provider实际被发布持有的共享锁阻塞；提交后停用生效，后续发布422且无第四版本。
  并发测试首次即通过已有本轮实现，不冒称额外RED修复。默认初始化竞争仍通过。
- 审计触发器对编辑/发布/停用分别注入失败，503且所有量规字段（含时间戳）不变、无版本/成功审计。
  历史snapshot为null/数组/非法dimensions/非法judge_type，以及当前草稿非法dimensions均固定409且原数据未改写；
  测试清理仅恢复本次合成注入，业务代码不自动修复历史。
- 最新PG161项通过，3.90秒、退出0，随机schema独立确认清理；仍未覆盖Provider全部失败矩阵及Python量规锁回补。
- 按Netlify Functions技能沿用现代default导出和现有_shared结构，新增休眠rubrics.mts，无config.path。
  直连Function URL（含伪route参数）在读取Netlify环境/DB前404；量规+部署策略2文件86项通过（0.82秒）。
  lint和完整build/typecheck通过，保留既有chunk提示。本轮未运行全量前端或后端，不能将上述数字描述为全量。
- 剩余：Python量规默认初始化/编辑/发布锁及损坏历史错误回补、更多双栈失败边界、候选TS、隔离页面/浏览器及独立双轴终审。
  生产path、环境变量、生产数据库未改动；04D保持coding，不能据六条量规路由完成宣称九路由切片或全量迁移完成。

## Python量规回补及候选HTTP边界

- Python历史结构损坏首次触发ResponseValidationError，增加只读投影校验后返回固定409，原数据不改写；
  候选版本冲突首次错误发布201，增加提交前冲突检查后409且草稿/历史不变。相关量规和评估32项通过。
- 新增test-rubrics-python-postgres.py，实际观察两Session发布锁、Provider停用竞争、默认初始化锁；
  编辑/停用持有行锁时，独立SQL同值UPDATE被阻塞。后两项不是两个业务HTTP写入的竞争证明。
  最终3.53秒退出0，独立确认随机schema清理。当地系统Python3.14驱动加项目纯Python依赖，不冒称CI3.12运行。
  CI已登记脚本但未推送。TS量规PG161项复跑通过（4.26秒），含25个实际双栈HTTP对比。
- 最新后端全量Session77018完成：589 passed，630.99秒，退出0；保留一项TestClient弃用警告，未安装依赖处理。
- 候选路由/字段解析先RED再实现；只接受列表、详情、确认三操作，确认体只含reason及幂等键。
  字符串不擅自trim；覆盖Unicode码点长度、空值/类型、别名冲突、额外样本内容拒绝、路径与Origin防护。
  候选29项+量规85项=114项通过，Session30939，17.66秒；这是边界测试，不代表数据库/专家授权已实现。
- lint通过；首次Vitest/build受沙箱spawn EPERM阻止，允许本地子进程后114项及完整build/typecheck通过。
  构建保留既有chunk大小提示；未重跑全部前端，之前Observability间歇worker卡顿仍未解决。
- 对抗式边界检查：不可把客户端提供的内容写为黄金样本；后续仍需服务端专家资格、来源锁、
  幂等约束和审计同事务验证。候选存储、页面、浏览器及独立终审未完成，04D继续coding；无生产操作。

## TS候选只读存储

- readFeedbackCandidates首个测试以501 RED，随后实现列表/详情、created_at倒序、固定404、三类来源同空间读取、
  固定409及显式public字段投影；复用身份事务、asset.read能力检查。不改Python、不新增生产入口。
- test-feedback-postgres.mjs使用本机55432随机schema、真实登录和独立SQL夹具：四角色列表/详情，
  空列表、排序、跨空间候选、三个来源分别跨空间/无归属/不存在、原数据不修复、成员撤销、CSRF均通过。
  最终69检查，0.95秒退出0，独立确认schema清理。这里使用合成读取来源，不宣称运行/人工任务来源生成已迁移。
- 确认暂时明确501，SQL确认无Golden Sample新增；不能把HTTP防护当专家资格授权。
  CI新增只读PG脚本但未推送或运行远程CI。候选确认事务、跨候选幂等竞争和human-task审计仍待实现。
- 相关3文件115项通过（0.81秒），lint及完整build/typecheck通过，构建既有chunk提示保留。
  未跑全量前端或浏览器，未改变界面；后端589是上一轮证据，本轮Python源码未变。
- 技能检查发现coding-skill-front仍有未展开占位符，未执行模板命令，按已确认仓库TDD流程推进。
  本轮仅本地工程推进，04D保持coding；线上切流和Zeabur退役未执行。

## TS专家确认事务首轮

- 无审核资格管理员测试首次501而非403 RED；增加User/Membership/Reviewer共享锁及活跃检查后通过。
  专家成功确认首次501而非201 RED；补候选行锁、来源共享锁、样本与状态及human-task审计同事务后通过。
- 按既有契约保留全局幂等键及candidate唯一约束；同键/候选/审核人重放原样本，不替换reason；
  重放仍校验当前专家资格，并额外拒绝历史样本workspace不匹配。只映射两个已知23505约束，其他异常回滚抛出。
- 真实PG93项通过（1.07秒）：受控运行输入/修改版本输出，候选状态、审计actor与payload独立SQL核对；
  重放、不同键/候选冲突、专家撤销/审核人停用、三类跨空间来源422；注入审计失败返回503，
  独立SQL确认无第二样本、无候选半更新、无第二审计。随机schema已独立确认清理。
- 相关115项（0.87秒）、lint/typecheck/build通过；保留既有chunk提示。未重跑全量前端/Python，Python源码未改。
- 未完成项：并发锁等待真实观察、跨候选唯一约束竞争、来源缺失确认矩阵、完整双栈共享HTTP及浏览器。
  Python当前仍有三条乱码提示，与TS清晰提示暂不完全一致；Python幂等历史workspace异常保护也需补齐并对照。
  资格修改路径存在联合FOR UPDATE OF m,u，不能仅根据确认SELECT顺序声称死锁竞争已验收。
  04D继续coding，无Function公共path、无推送部署或生产切流。

## Python重放隔离及TS同候选并发

- 新测试复现Python历史样本workspace归属损坏仍返回201；加入workspace一致性后409固定中文且不改历史。
  首次pytest因系统临时目录权限失败，不计业务RED；指定工作区独立basetemp后确实201!=409 RED。
  同时修正确认入口三条既有乱码提示，正常重放不覆盖reason、不同键已确认409、缺失候选422显式测试通过。
- Python样本/人工审核两文件34项通过（53.75秒）；随后新增提示测试与重放保护2项通过（4.17秒）。
  全量后端新启动Session39319，未取得终态前不引用旧589项证明本次全量通过。
- PG同候选竞争使用两个独立登录Session和查询控制门，pg_blocking_pids观察第二事务被第一候选行锁阻塞。
  两个201响应完全相同；独立SQL仅一份该候选样本、一条对应human-task审计。该并发测试首次通过现有实现，非新增RED修复。
  当前PG100项通过（1.23秒），随机schema清理独立确认。仍未证明跨候选唯一键及资格/来源修改竞争。
- lint、build/typecheck、deploy:check通过（构建既有chunk提示保留）。本轮尚未执行完整双栈HTTP/浏览器，04D保持coding。

## TS跨候选及依赖锁竞争

- 两个不同候选、独立Session同幂等键：第一事务插入后暂停，第二事务已通过前置查重并尝试INSERT；
  pg_blocking_pids实际观察唯一索引等待。释放后第一201、第二固定409，失败候选状态/confirmed_at不变，无样本和审计残留。
- 确认在INSERT前持有资格/来源共享锁；独立SQL撤销reviewer.is_expert被阻塞，提交后撤销生效，重放403。
  修改版本、运行、人工任务三种来源分别用workspace_id同值UPDATE验证实际阻塞，确认201后更新才结束。
  这不是完整资格管理HTTP竞争，也不是生产来源生成链迁移证明；联合m/u锁路径仍需专门测试。
- 最终PG126项通过（1.51秒），随机schema独立确认清理。这些测试首次通过既有实现，不冒称新修复RED。
  本轮仅改测试与文档，lint/deploy:check通过；构建为上一轮证据。后端Session39319仍运行，最近已过48%，未据此宣称全量通过。
  04D继续coding，下一步完整共享HTTP和页面；未部署或切流。

## 候选实际双栈HTTP对比

- 后端Session39319终态退出0：591项通过、613秒，一项既有TestClient弃用警告。覆盖本次Python重放隔离和错误提示修改。
- 新增feedback-http-python.py：明确禁用env_file，重建来自本机PG的七张合成表至临时SQLite，
  使用真实Python登录上下文及路由请求；不调用模型，不将合成来源等同生成链迁移。
- PG脚本重放12个同组请求：列表/详情/缺失和外空间详情、空理由、全局键冲突、缺失候选确认、
  snake_case键含空白合法确认、确认后详情、重复确认、不同键冲突、额外expectedOutput拒绝。
  比较完整状态及响应字段，仅归一化创建/确认时间与动态Golden Sample ID；业务引用ID、内容、标签和null不隐藏。
  每条合成候选设置不同时间，验证列表倒序而不依赖相同时间的未定义顺序。
- 最终PG139项通过（3.83秒），12实际双栈请求包含在其中，随机schema独立确认清理；lint/deploy:check通过。
  Python与TS测试用户均具有管理员权限和显式专家资格，但不据此覆盖所有角色矩阵或资格撤销HTTP竞争。
  本轮仅增加测试脚本及文档，应用源码未改；未新跑完整前端/浏览器。04D仍coding，下一步迁移页面和剩余终审。

## 独立候选迁移面板首轮

- 显式rubric-samples模式继承04A/B/C资产限制；Reviews入口分支为独立FeedbackCandidates，旧页面代码不改行为。
  新面板只请求候选列表/详情/确认，不以空任务/运行数组模拟迁移。首个测试在旧入口Auth依赖处失败，
  分离入口后来源展示及严格请求集合通过；该RED为入口缺失，不冒称复现了后端错误。
- 使用服务端最终专家资格，展示原始/修改版本和Diff；失败不当成空列表；确认重试固定原理由和幂等键，
  同一挂载周期切换候选保留请求键。成功后刷新失败明确提示且当前详情不再提供重复确认按钮。
- 页面+旧Reviews两文件21项通过，build/typecheck通过；首次lint新增ref清理警告已局部修正，最终lint无警告。
  不使用样本创建时间伪造候选confirmedAt。当前仅组件测试，无视觉/真实同库浏览器验收。
- coding-skill-front模板框架/命令不适配，按仓库React TDD流程实现，未执行占位符命令。
  仍需错误/失效详情/切换和403更多测试、量规页面、休眠Function/隔离服务和同库浏览器；04D继续coding，无生产操作。

## 量规迁移页面及隔离浏览器首轮

- 核对Evaluations已只依赖量规和Provider，不重做页面。新增migration范围提示；Provider加载失败时编辑页显示错误/重试，
  控件与写处理函数同时阻断。测试先因编辑页不显示Provider错误RED，修复后量规/候选两文件10项通过。
- 本机隔离服务接入量规/候选路由，Vite验证模式提升rubric-samples并继承04A/B/C保护，未知API仍501不代理Zeabur。
  首次启动因resolveRubricsRoute拼写错失败，按实际resolveRubricRoute导出修正；不计业务RED。
- 新浏览器量规路径实际创建201、发布v1.0.0、刷新后字段与版本记录仍在；全程无外部或执行请求。
  首次用短暂创建提示做断言失败，实际已进入编辑页；改查HTTP201/持久字段。
  第二次版本定位遗漏“版本 ”前缀，按真实DOM修正；两次均记录5既有路径通过，不掩盖首次失败。
  最终Session70225退出0：六条同库浏览器全部通过（25.2秒），随机schema清理独立确认。
- lint、build/typecheck通过，既有chunk提示保留。已查看量规截图顶部：范围提示和保存字段可见；
  内部滚动区域下半屏未在该截图展示，不据此声称完整视觉验收。
  仍需量规编辑/第二版/停用浏览器、候选专家与非专家浏览器、最终全量及审查；04D继续coding，无生产操作。

## 量规完整生命周期及候选浏览器

- 扩展量规用例：编辑通过分数95、第二次发布v1.1.0；浏览器读取真实历史响应确认旧版85/新版95，
  停用后刷新分数保持、保存/发布禁用、两个历史版本仍显示。单路径13.5秒通过。
- 隔离服务新增显式合成专家和非专家、活跃成员/Reviewer及候选读取/确认所需来源；不新增生产seed或生成链API。
  候选浏览器只访问治理接口，专家201及刷新已确认，非专家403及刷新待确认；无人工任务/运行/Reviewer目录请求。
- 最终Session62172退出0：八条同库浏览器全部通过（28.8秒），此前五条资产/Agent/Data Object也回归通过。
  随机schema清理独立确认。lint/deploy:check通过，本轮仅测试夹具和用例变化，build沿用上一轮。
- 已查看非专家刷新截图，来源文字和状态可读；候选面板按钮仍使用浏览器默认样式，内层滚动下部未在截图展示。
  不能据此声称完整视觉交付；下一步页面失败/异步边界、样式收口、资格HTTP竞争及最终全量/审查，04D仍coding。

## 发布成功后的读取失败保护

- 首个测试复现发布201后历史503仍走通用错误且允许再次发布；新增独立publicationRefreshError，
  保留发布成功反馈，锁住发布按钮/处理函数，提供只重试版本读取按钮，不再把空历史显示为“暂无已发布版本”。
  RED缺失明确成功/刷新失败提示，GREEN确认只一次POST发布、三次GET历史（初始/失败/重试）。
- 量规/候选两文件11项通过（3.28秒），lint和完整build/typecheck通过；既有chunk提示保留。
  该修正同时适用于默认与迁移量规页；未修改后端、未生产操作。
- 当前完整前端Session34333退出0：61文件595项通过（20.45秒），包括Observability全部用例。
  本次为一次完整通过，但不证明以前间歇worker卡顿根因已修复；最终独立审查和剩余边界仍未完成。

## 2026-09-05 最终收尾（覆盖上方待审状态）

- 资格管理真实PG复现两个锁序死锁（40P01），修复User/Session和User/Membership顺序。
  `test-feedback-identity-race.mjs`调真实管理与确认HTTP Handler，四种他人管理与四种同Session自管理均通过。
  核对实际锁等待、201确认、撤销后403/404/401、自停用409与保持active、每候选单样本/审计及schema清理。
  只覆盖确认先持锁再管理竞争，不声称穷举所有排列。脚本已按@netlify/database解析pg、限定loopback、
  默认5432、设置连接/语句/gate超时并注册CI；未运行远程CI。
- 候选旧列表覆盖确认状态取得deferred RED，统一listGeneration后GREEN；休眠入口测试先缺模块RED，
  补feedback-candidates.mts后GREEN，直连404早于环境/数据库访问，无公共path。
- 独立Spec审查的量规历史串线与晚写入/创建回跳取得RED/GREEN；Workspace/route key、mounted及代次保护。
  Agent/量规最终聚焦35项通过，15.47秒，Session76176。初始文本定位器错误未算业务RED。
- 主线程重跑量规PG161（4.11秒）、候选PG139（3.90秒）、身份129、资产198、Agent232、Data Object62通过。
- 全量前端第一次604通过/1失败：旧审核页在clipboard完成后的同步提示断言过早；改findByText等待同一提示，
  聚焦Reviews19项通过，最终Session57279全量61文件605项，19.83秒。
  不宣称已查明以前间歇worker卡顿根因。
- 候选沿用项目按钮/面板样式，内容自动换行；浏览器加入滚动后确认区截图。
  最终Session87155完整8条29.7秒通过，随机schema独立确认清理；已查看底部来源、diff、确认输入及按钮。
- lint/deploy:check/build含Netlify typecheck最终退出0，既有大chunk提示保留。
  Python当前全量591项仍为本轮此前Session39319终态证据，此后未改Python源码，不标为重复新跑。
- 两轴独立结论见review.md；04D本地工程ready-for-human。未提交推送/部署，生产生成链和评分能力未迁移。
