# 续行小修复：独立 Standards 轴审查

日期：2026-09-06。审查者：`native_composition`，未参与本次两个提交的产品/设施实现。
范围：`52e36f8a2b2425a505a16d39ad3a584fa2babde8` 的观测页与测试抽取，
`68f9f6bcc22ba9d719b9988485ee92c9dce615da` 的三个测试数据库脚本。

依据：`AGENTS.md`、`.harness/rules/`、原生迁移 PRD、07f 及下列已确认设计：

- `docs/superpowers/specs/2026-09-06-observability-navigation-design.md`
- `docs/superpowers/specs/2026-09-06-reference-assets-fixture-migrations-design.md`

完整读取 `expert-reviewer-front`，仅采用 Standards/公共维度；项目 React/Node 规则优先于技能内 Vue、覆盖率默认要求。
Spec 轴保留为另一审查者的 `observability-navigation-review.md`、`asset-fixture-migrations-review.md`，本报告不替代或混合两轴结论。

## 52e36f8：观测页导航与详情隔离

**阻断：0。建议：0。** 本结论只覆盖两条已复现缺陷及该提交的有界修改。

1. **状态和依赖方向**：移除 `selectedRunId` 镜像 state 及相互回写 effect，以有效且可见 URL runId 派生选中值；无效或缺失时派生默认项。点击仍复用 `writeSearchParams`，没有新增导航框架、跨组件全局状态或 API 层反向依赖。
2. **错误边界**：详情请求的成功、catch、finally 都由本次 effect 的局部 `current` 守卫；新选择清理旧详情和错误，空选择结束 loading，cleanup 对选择变更、Workspace 变更与卸载生效。没有吞掉当前请求错误或把失败设为完成，没有新增自动重试/写入。此守卫隔离的是旧请求写回，不宣称已物理取消网络请求。
3. **隔离与安全**：请求仍通过 `src/api/` 并携带当前 Workspace ID；未改变能力守卫、Session/CSRF、操作控制、后端结果或生产配置。未扩张到原页面 overview/SLA/队列等无关请求，也不把局部详情修复声称为全页请求生命周期治理。
4. **复杂度和兼容**：复用已有过滤结果和默认风险选择，减少第二套状态，不增加产品导航次数上限。URL 规范化、筛选和点击清除 nodeRunId 仍在原接缝；20 次护栏只存在于新测试中，超出会明确抛错，不是运行时截断/吞错策略。
5. **测试接缝**：新测试使用真实 Observability 与 MemoryRouter，仅受控延迟 setter 提交和 fetch 响应，断言 URL、选中样式、导航次数及最终正文；不是 mock 被修复的选中逻辑。旧详情迟到释放后明确拒绝旧正文。afterEach 清理渲染、fetch stub 和导航队列，未新增环境/外部依赖。
6. **无弱化断言**：本审查者用 Git 读取提交前后正文并逐字符比较：9 个常量仅从 const 改为 export const 并移动，内容完全一致；`LocationProbe` 起的旧测试主体完全一致，原 12 个 `it` 保留。未调高 timeout、删用例或将错误转成跳过。

已有新验证（来源明确）：Spec 审查记录两条正式 RED→GREEN 及 14 项通过；主线程回执记录 8 分片 71 文件/696 项、lint/build 和 7 条本地运行浏览器通过。本审查未重复这些执行，也不据此宣称所有历史卡死均已找到唯一根因。

## 68f9f6b：资产合同/浏览器夹具结构迁移

**阻断：0。建议：0。** 修复测试准备依赖，没有修改生产查询和合同断言。

1. **架构接缝**：`applyTestMigrations(client)` 原样提取 runtime fixture 已有结构迁移循环，三个调用方共享同一实现；接收调用方 client，不建立隐藏 pool、不改变搜索路径、不引入安装或网络动作。模块导入只解析现有 pg 依赖，创建连接仍在显式 fixture 函数或原调用方中。
2. **失败传播**：迁移顺序 await，无 catch 吞错、缺表回退或默认空结果。测试必须先成功建表再进入原业务断言。helper 不伪称事务性迁移；部分迁移失败仍由既有调用方 catch/finally 清理隔离 schema。
3. **隔离范围**：三个调用方保留固定 loopback、`arc_identity_test`、数值端口校验、随机十六进制 schema；DROP 目标仅来自当次生成值。生产连接串、环境文件、真实凭证或公开 Function 都未进入变化范围。浏览器服务仍在完整准备成功后监听，准备失败走原 close 路径，不发布假 ready。
4. **当前 SQL 的安全边界**：本审查无 DB 调用真实 helper，记录型 client 收到 8 个按名称排序的非 seed SQL，逐项与实际文件完整内容一致；未发现 `SET search_path`、`CREATE SCHEMA` 或 `public.` 定位。preview seed 名称仍被排除，未读取其正文。本结论不自动保证未来任意新增 migration，名称过滤也不被描述为通用安全扫描。
5. **独立异常证据**：第二次 query 注入固定异常，helper 以同一异常拒绝且调用次数严格等于 2；不会继续第三条或宣称成功。该验证纯内存，不建立数据库连接，进程 exit 0。
6. **无掩盖失败**：两个资产调用方的差异只有 helper 导入及替换旧两文件初始化循环；HTTP 200、历史治理、角色/跨 Workspace 断言、Python 共享合同和进程退出逻辑均未弱化。只为当前实际引用 runtime 历史关系的夹具补齐依赖，未无差别扩大其他独立域测试。

已有新验证（来源明确）：主线程回执记录原缺表导致 503/200 的 RED，修复后资产 198 checks、52 roleRouteChecks、26 sharedRequestCases、22 原生程序及 9 条浏览器通过。选择已安装的 API Python 环境解决解释器缺依赖，没有新装包或跳过合同。上述不等同本审查者重新运行 PG。

## 本审查的新证据与最终边界

- 确认当前上述 7 个文件相对对应提交无后续差异，所查工作区内容匹配被审查提交。
- 逐字符核对抽取 fixture 与原 12 例主体，均一致。
- 无数据库执行共享 helper：8 条顺序/内容一致、当前 SQL 不越 schema、第二条错误立即原样传播，全部通过。
- 未改产品或测试实现，未重跑全量、未启动 PG、未新建 Agent、未读凭证、未操作部署或收费。

两个切片 Standards 均为零阻断；这是有界工程审查放行，不是 `68f9f6b` 云端 CI 成功声明。
CI `34027123972` 最终状态仍由主线程核对；Netlify credit 阻断、生产源备份/恢复、迁移对账、公开宿主、切流和 Zeabur 退役不由本报告签收。
