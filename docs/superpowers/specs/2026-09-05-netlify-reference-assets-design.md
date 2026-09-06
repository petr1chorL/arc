# 04A 引用资产迁移：源码契约与设计草案

状态：用户已确认详细设计、隐藏规则与实施计划；04A 本地工程已验证通过，未发布或切流。源码基线：`b56b991`。
最新实施/验证见 `.harness/changes/netlify-reference-assets/{change,verify,review}.md`。
下文“待确认”“尚未实现”保留设计演进时的记录，不覆盖最新工程回执；未连接生产业务库、解析凭证或执行线上写入。

## 第一性原理

目的：为后续 Agent 发布提供可持久化、可隔离、可停用的引用资产。
必要对象为 Workspace、操作者、资产稳定 ID、状态、非密钥配置和审计；
登记成功不代表连接成功，更不代表 HTTP/MCP/模型执行可用。
先固定旧实现真实契约，再决定必要的安全差异，不在迁移中顺手统一权限或默认状态。

## 已核实的 API

共同前缀：`/api/workspaces/{workspace_id}`（`apps/api/app/main.py:406`）。
以下权限为 capability；最低角色见 `apps/api/app/access.py:27`，组织管理员按既有规则处理。

| 方法与相对路径 | 正常状态 | Capability | 04A 范围 |
|---|---|---|---|
| GET `/model-providers` | 200，数组 | asset.read / viewer | 核心 |
| POST `/model-providers` | 201，对象 | agent.write / builder | 核心 |
| POST `/model-providers/{provider_id}/deactivate` | 200，对象 | agent.write / builder | 核心 |
| GET `/asset-library` | 200，数组 | asset.read / viewer | 核心 |
| POST `/asset-library` | 201，对象 | agent.write / builder | 核心 |
| POST `/asset-library/{asset_id}/deactivate` | 200，对象 | asset.deactivate / workspace_admin | 核心 |
| PATCH `/model-providers/{provider_id}` | 200，对象 | agent.write / builder | 纳入详细设计 |
| PATCH `/asset-library/{asset_id}` | 200，对象 | agent.write / builder | 纳入详细设计 |

来源：`apps/api/app/main.py:1946`、`:2001`、`:2057`、`:2112`、`:2306`、`:2327`、`:2386`、`:2439`。
所有写入口依赖 write_workspace_context，包含 Session、Workspace 与 CSRF 检查；
失效/跨组织/无成员 Workspace 返回 404，拒绝访问可能留下 denied 审计，并非所有拒绝都零写入。
来源：`apps/api/app/access.py:236`、`:279`。

## 字段与状态：不能统一处理

### Model Provider

- 创建：`name`(1–120)、`baseUrl`(1–500)、`defaultModel`(1–120)、`secretRef`(1–160)；
  `providerType` 默认 `openai-compatible`，另一个允许值为 `anthropic-compatible`。
- 上述字符串 strip 后不得为空；允许字段名和 alias；额外字段忽略。
- 响应：`id,name,providerType,baseUrl,defaultModel,secretRef,status,createdBy,createdAt,updatedAt`。
- UUID 主键；创建默认 **draft**，不是 active。停用改为 disabled、更新时间并写成功审计，不物理删除。
- 唯一约束为 `(workspace_id,name)`，冲突 409 / `模型 Provider 名称已存在`。
- Secret Ref 正则为 `[A-Z_][A-Z0-9_]*`；非法引用返回固定 422 文案，不回显值。
  这是引用语法校验，不是环境变量存在性或模型可用性证明。
- 创建入口只把 baseUrl 当字符串保存，不应把执行出口 HTTPS/Host 校验描述成登记时已有的校验。
- `/test` 只检查后端 Secret Ref 解析结果，不发模型请求，也不把 draft 改为 active；本片不解析真实凭证。
- Agent 当前绑定解析只拒绝 disabled Provider，不拒绝 draft；后续 04B 不应擅自增加 active-only 条件。

来源：`apps/api/app/schemas.py:550`、`:594`；`apps/api/app/models.py:273`；
`apps/api/app/runtime_security.py:10`；`apps/api/app/main.py:500`、`:2332`、`:2440`、`:2671`。

### Tool / Skill

- 创建：`assetType` 为 tool/skill，`name`(1–120，strip 非空)，`description` 默认空、上限 2000；
  `parameterSchema` 默认对象 `{}`，`adapterType` 为 manual/http/mcp，默认 manual，`adapterConfig` 默认 `{}`。
- 响应：`id,assetType,name,description,parameterSchema,adapterType,adapterConfig,status,createdBy,createdAt,updatedAt`。
- UUID 主键；创建默认 **active**；唯一约束为 `(workspace_id,asset_type,name)`。
- 名称冲突 409 / `资产名称已存在`；跨 Workspace / 不存在 ID 返回 404 / `Tool / Skill 资产不存在`。
- 创建 schema 未声明 extra=forbid，更新 schema 声明 extra=forbid；更新的 None 字段被路由跳过。
  Provider 更新采用 exclude_unset 后逐字段赋值，两者 null/缺省语义不能用一个通用 PATCH 实现。
- 成功创建/更新/停用与成功审计同事务提交；重复停用仍执行更新时间和审计，不应误称审计幂等。

来源：`apps/api/app/schemas.py:325`、`:329`、`:348`、`:368`；
`apps/api/app/models.py:195`；`apps/api/app/main.py:543`、`:2006`、`:2058`、`:2113`。

## 已发现的设计阻断

### A. 自由配置与密钥保护冲突

当前 Tool/Skill adapterConfig 为任意 dict，创建/更新直接落库、读取直接序列化。
没有看到在这些入口拒绝任意嵌套密钥字段的机制，不能据此承诺“任何内联密钥都不会保存或返回”。
同样不能以“前端没有 apiKey 输入框”替代 API 防护。此处为源码发现，未用真实密钥做验证。
自由文本或 URL 也不能靠简单关键字黑名单证明绝无凭证。

可选方案：

1. **推荐：先明确并补齐非密钥适配配置的允许结构，再迁移完整登记能力。**
   对 HTTP/MCP/manual 分别确定允许字段、URL 凭证位置限制、Secret Ref 规则与固定拒绝响应；
   新旧实现的有意安全差异列清单并测试。旧配置不得静默丢弃或自动改写，真实数据兼容问题留给迁移对账。
2. 先只迁 Provider 与 manual + 空 adapterConfig 的 Tool/Skill，HTTP/MCP 登记留后续。
   代码更少，但缩窄当前三类资产兼容范围，不能把 04A 全部登记能力标为完成。

不推荐原样保存任意配置后仅靠 UI 提示“不要填密钥”。设计确认前不实施任何方案。

### B. 页面与未迁移接口不能混用

`src/pages/AssetLibrary.tsx:111` 在 Promise.all 中同时读取资产与调用日志；
随后读取 impact 和 audit-events。`src/pages/ModelProviders.tsx:45` 也读取 impact。
仅接通六个核心接口不等于完整页面可用；新库 ID 不能传给 Zeabur 的旧日志/impact/执行服务。

建议先完成隔离 API 契约与数据库测试，仍保留休眠 Function、不改生产路由。
页面验收前明确选择：补齐本片必要只读接口，或显示明确的迁移范围提示并禁用未支持入口。
禁止伪造空日志/零影响面响应来制造成功。两种方式需随最终设计锁定，当前不增加临时公共测试页。

## 实现方向（待确认，不是已完成能力）

- 使用现有身份/Workspace 边界与 PostgreSQL 基线表；资产模块与身份模块分开，复用已确认的授权和事务边界。
- 写事务使用参数化 SQL，资产与成功审计原子提交；唯一约束兜底映射 409，不把竞争冲突变成 500。
- 凭证只作为引用标签，不在此片读取值或验证真实供应商连接；HTTP/MCP 调用、Agent 运行不在范围内。
- Production /api 代理和永久 migration 不变；不增加公开固定测试账户，不自动部署 Preview。

## 实施前的测试清单

- Python 旧实现 / TS 新实现按相同合成用例重放；规范化随机 ID 与时间，不跳过响应字段、状态和权限差异。
- 创建 → 新连接列表读取 → 停用 → 再读取；Provider draft 与 Tool/Skill active 默认值分别断言。
- viewer/builder/admin 权限矩阵，缺少 CSRF、未登录、跨 Workspace 查询与写入拒绝。
- 名称重复及并发重复、同名不同 Workspace、同名不同 assetType；失败无半写入和虚假成功审计。
- Secret Ref 非法输入、配置允许结构拒绝、响应/错误/审计不回显凭证样例；所有样例必须为明确合成值。
- 数据库失败回滚、重复停用审计、未知字段和 null/缺省差异；安全差异与兼容差异分开记录。
- 测试禁止真实模型/HTTP/MCP 外呼；页面不得混合新旧库；最后再做 lint/build 与适用浏览器验证。

## 当前验收结论

源码事实盘点完成；用户已选择继续细化推荐方案，具体规则见下一节。
本轮仅完成详细设计；未运行新的行为测试、未发布新版本、未增加迁移完成数量。

## 详细设计（2026-09-05 续）

本节是拟实施规则，不把新限制冒称旧系统已有行为。上方可选方案保留决策背景；
选择补齐安全限制与必要只读接口，不使用仅隐藏报错或回退 Zeabur 的方案。

### 1. 13 个接口的边界

上述 8 个 CRUD/停用接口，加上以下 5 个只读接口，构成本片完整接口范围。

| GET 相对路径 | 权限 | 读取语义 |
|---|---|---|
| `/asset-library/invocations` | asset.read | Workspace 内按 assetId、agentId、status 可选筛选，createdAt 倒序 |
| `/asset-library/{asset_id}/impact` | asset.read | 同空间 Agent 草稿与发布版本，稳定引用 ID 或既有名称回退匹配 |
| `/asset-library/{asset_id}/audit-events` | audit.read | limit 默认 20，1–100；目标审计与调用事件各取 limit，合并按时间/ID 倒序再截断 |
| `/model-providers/{provider_id}/impact` | asset.read | 同空间草稿 model_provider_id 与版本 snapshot.modelProviderId 匹配 |
| `/model-providers/{provider_id}/audit-events` | audit.read | limit 默认 10，1–50；先取空间最近 200 条，再按目标/来源 Provider 关系筛选至 limit |

来源：`apps/api/app/main.py:1972`、`:2148`、`:2221`、`:2475`、`:2614`。
不能擅自优化为不同筛选顺序，否则审计返回集合会变。空集合必须来自真实 SQL 查询。
使用基线里的 agents、agent_versions、audit_events 和 tool_skill_asset_invocations 做只读查询，
不因此实现 Agent 写入、发布或运行。隔离测试直接构造这些表的合成记录验证非空与跨空间情况。

以下不迁移：Provider `/test`、`/migrate-drafts`，Tool `/test-invocations`、运行派发。
迁移模式界面禁用相关按钮并显示“当前迁移切片暂不支持”；服务器保留失败关闭边界，
不能只依赖按钮禁用。在隔离端到端服务器中，对全部未迁移 `/api/*` 返回明确的
501 / `当前迁移切片暂不支持该操作`，无到 Zeabur 的代理。

### 2. 新写入的配置允许结构

| 对象 | 允许内容 | 拒绝内容 |
|---|---|---|
| manual adapterConfig | 仅 `{}` | 任何键、数组、标量或 null |
| http adapterConfig | 必填 `url`；可选 `method`，仅 GET/POST，缺省按既有运行语义 POST | 其他所有键，包括 headers、apiKey、token、secretRef、auth、body、嵌套对象 |
| mcp adapterConfig | 本片仅 `{}`，保留 mcp 类型与名称/描述/parameterSchema 登记 | 任意连接配置；不杜撰尚未确定的 MCP Server 契约 |
| Provider | 保留既有字段和 Secret Ref 语法，增加 baseUrl 安全 URL 校验 | 不接受 URL 鉴权、查询或片段携带凭证 |

HTTP url 与 Provider baseUrl：字符串 strip 后，长度 1–500；要求绝对 HTTPS、有效主机、
无 userinfo、无 query/fragment（包括空分隔符），拒绝控制字符、反斜杠和 IP literal，
只允许缺省端口或 443。不做 DNS 解析或外呼，不新增主机连通性检查；保存合格原始字符串，
不以 URL 库静默重写路径。URL 路径与名称/描述仍是用户文本，不能承诺识别任意伪装的密钥；
文案和验收只承诺阻断已定义凭证槽位与未批准配置结构，不声称通用 DLP。

HTTP method 若显式提供必须是 GET/POST，不接受 null 或强制转换任意类型；
缺省 method 的响应保留缺省字段状态，不为兼容性任意补写。parameterSchema 保持对象契约，
不把其中描述用的“token”属性名称当成密钥误删，不解析或执行 Schema 内容。

MCP 的限制是有意的兼容收缩：可以登记资产，但不能保留任意旧连接配置；
完整 MCP 配置需在真实协议确定后再设计，并非本片已实现。

### 3. 写入、读取、错误和审计

- 创建和 PATCH 都必须校验最终有效 adapterType + adapterConfig 组合；仅改类型也要校验旧配置与新类型是否兼容。
- Provider PATCH 的必填持久化列不允许显式 null（返回 422），避免继承旧实现潜在数据库错误；缺省字段不改变。
  Tool PATCH 保留既有 None 跳过语义，但最终组合仍要校验。
- 配置拒绝统一为 422 / `资产配置包含不支持或不安全的字段`；Provider URL 拒绝为
  422 / `Provider 地址不符合安全登记规则`。Secret Ref 原固定文案保留。
- 配置错误不得经默认验证异常把原始 input 或键值写入响应；错误、日志和拒绝审计不带原始正文。
  既有合法字段契约保持；安全拒绝路径属于明确的新旧差异。
- 列表、PATCH/停用响应、impact 中的引用与相关日志/审计序列化都要防止历史敏感值回显。
  已知配置/Secret Ref/URL 字段按同一规则检查，审计 metadata 只输出批准的业务字段，不能直接透传任意 metadata。
  历史 inputSummary/outputSummary 和自由文本原因采用第 6 节的确定性隐藏规则，不依赖关键词检测。
- 不合格历史配置不在读取时修复或落库。相关响应返回 409 /
  `存在不符合当前安全规则的历史资产或记录，需先完成治理`，不返回原值；列表遇到该情况整次失败，
  前端显示明确阻断而不是空列表。这是可用性取舍，不直接部署到旧生产。
- 批量治理和真实数据清洗不在本片；未来迁移对账只记录对象 ID/字段路径/规则编号，不输出原配置，
  必须经过单独确认才改写既有数据。停用不能删除历史快照。
- 写入与成功审计同事务；失败回滚，授权拒绝审计仍按现有 commitOnError 语义保留。
  SQL 唯一约束冲突映射 409；重复停用保留既有更新时间/审计语义，不擅自改成幂等事件。

### 4. 页面适配与环境隔离

- AssetLibrary 与 ModelProviders 保留列表、创建、编辑、停用和已迁移只读展示。
- 对迁移模式增加一个统一、显式的能力入口，默认旧生产模式不变；不为每个按钮创建独立开关。
  浏览器测试必须断言迁移模式从不请求上述三个未迁移接口，也不访问 Zeabur 域名。
- HTTP 配置改用方法与 URL 字段；manual/MCP 提示本片只接受空配置，参数 Schema 编辑保留。
  不新增 Tool Secret Ref 输入框（当前执行契约未消费它）。Provider 只填写引用标签。
- impact/审计加载失败不能继续展示旧值或伪造零影响面，分别显示不可用；
  403 审计权限拒绝不使资产列表整体失败，也不绕过权限。
- 新身份、资产、日志与关联快照必须来自同一个隔离数据库。采用本地隔离端到端服务器验证，
  不在现有混合 Preview 上直接复用旧生产登录。后续云端 Preview 需另行明确路由与合成身份方案并取得部署授权。
- Production netlify.toml、业务数据库、环境变量和 Zeabur 均不变；新 Function 保持休眠。

### 5. 最小代码组织与验证顺序

拟新增资产配置策略、资产路由/后端模块；复用身份的 Session、CSRF、限流和权限语义，
不复制一套登录系统，不把全部资产 SQL 继续塞入身份 switch。涉及抽取现有私有帮助函数时，
先补等价回归，再做最小提取，不建设通用框架。不会改历史 baseline migration。

1. 先用合成配置对 Python 创建/更新/读取路径做 RED，证明旧代码接受不安全配置或回显；然后实现明确规则。
2. 同一份配置允许/拒绝用例覆盖 Python 与 TS，包含类型改变、历史值、null/缺省与 URL 边界；记录有意差异。
3. 实现 13 个 TS 接口并做真实隔离 PG 重放，覆盖非空影响面、审计排序/截断、日志筛选、越权与竞争冲突。
4. 迁移模式页面接入；本地隔离端到端覆盖登记→编辑→刷新→停用，断言无不支持接口与外域请求。
5. 完整回归、lint、build、部署配置检查和对抗式审阅；凭新证据签收工程切片，生产发布单独进行。

已定位的源文件：`apps/api/app/main.py`、`schemas.py`、`runtime_security.py`、
`netlify/functions/_shared/identity-workspace/{handler,postgres,domain,routes}.ts`、
`src/pages/{AssetLibrary,ModelProviders}.tsx` 及相应 API/页面测试。
实施计划将在详细设计审阅后按真实模块接缝编写，不把以上顺序冒称已经执行的 TDD。

### 6. 审计与调用记录的确定性输出策略

2026-09-05 续接核查：`AuditService.record` 默认 metadata 为 {}；两类资产的 create/update/deactivate
成功事件未传 metadata；Provider migrate_drafts 传 sourceProviderId、targetProviderId、reason、
migratedAgentIds。ToolRuntimeExecutor 把参数 JSON 直接作为 input_summary，HTTP 网关摘要为外部响应截断，
因此无法靠字段名称、字符串长度或关键词证明这些文本没有敏感值。

本节替代“无法确认摘要安全就阻断整个响应”的初稿：对自由摘要做明确隐藏，保留记录事实；
不合格资产配置仍按第 3 节返回 409。此处是待实施的显式兼容差异，不是现有能力。

| 记录 | 可返回 metadata / 内容 |
|---|---|
| model_provider.create/update/deactivate | 成功事件 metadata 为 {} |
| tool_skill_asset.create/update/deactivate/test_invoke | 成功事件 metadata 为 {}；test_invoke 仅兼容历史读取，不开放执行 |
| model_provider.migrate_drafts | sourceProviderId、targetProviderId、migratedAgentIds；reason 非空时用固定隐藏提示 |
| 上述资产域的授权拒绝事件 | 仅 capability，必须属于当前权限矩阵；不透传其他字段 |
| tool_skill_asset.invocation 合成事件 | assetId、assetType、agentId、runId、nodeRunId、durationMs 保留；assetName、agentVersion、inputSummary、outputSummary 按下述隐藏规则 |

- 事件外层保留 id/eventType/targetType/targetId/outcome/actorId/createdAt；reason 为空仍为空，
  非空统一为 `内容已隐藏（迁移安全策略）`。不返回原文、前后缀、长度或哈希。
- 调用列表字段形状不变；inputSummary、outputSummary、error、历史 assetName 和 agentVersion
  非空时使用同一提示，空字符串保持空；合成审计事件复用相同投影，不留第二条原文出口。
  这是保守隐藏，不表示原记录已被判定含密钥；不更改存储记录。
- metadata 严格按事件类别投影，未知键不回传；迁移界面固定说明“摘要、原因及部分历史展示字段已隐藏”，
  不能把它们展示成不存在。未知动作保留记录位置，但 eventType 使用 `unsupported_event`、
  metadata 为 {}、reason 为固定隐藏提示；不丢弃事件或改变排序与截断。
- ID 与 ID 数组必须为字符串（允许现有合成测试的非 UUID ID），且具有对应 Workspace 的实体引用；
  无法建立作用域关系时不回显该值并返回固定 409。nullable 关联仍允许 null，不把缺少关联改为虚构对象。
  actorId 要验证组织归属；历史实体缺失属于未来真实数据治理门禁，不自动清洗。
- assetType/status/outcome/capability/targetType 按对应源码枚举或有限状态清单检查；durationMs 为非负整数；
  时间必须可解析。未知结构返回固定 409，不把数据库异常或原始内容拼入消息。
- ID、经允许结构校验的配置、用户编辑的名称/描述/Schema 不宣称具有通用 DLP 能力。
  本片只关闭已识别的任意日志正文和 metadata 透传出口，不承诺任意字段永不含秘密。
- 先按旧规则选取、过滤、排序、截断，再投影；Provider 仍先取 Workspace 最近 200 条再选关联项，
  Tool 审计仍合并两组各 limit 条记录后排序截断。不得因隐藏改变返回数量或伪造成功状态。

测试用合成哨兵覆盖每条输出路径：配置、嵌套 metadata、摘要、error、reason、历史名称与版本；
断言响应及被测试的日志/审计输出不含哨兵，同时数据库原记录保持不变。
非空日志、失败日志、未知动作、相同时间排序、权限拒绝与跨 Workspace 关联都必须覆盖。

实施计划见 `../plans/2026-09-05-netlify-reference-assets.md`。本轮只完成设计与计划，
隐藏策略属于新增可见行为，用户随后已确认；Issue 已进入 ready-for-agent，完成需以实施验证为准。
