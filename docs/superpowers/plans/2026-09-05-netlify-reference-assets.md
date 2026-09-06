# 04A 引用资产迁移实施计划

日期：2026-09-05。状态：用户已批准；配置/Python 接入已有验证，内部 TS 13 路由与合成 PG 正在执行第 3–4 步，尚未签收。
设计：`../specs/2026-09-05-netlify-reference-assets-design.md`。
范围：13 个登记、编辑、停用及只读接口；不部署、不切流、不迁移真实数据、不调用外部模型或工具。
Superpowers 技能当前不可用，按 `docs/PROJECT_WORKFLOW.md` 的设计、TDD 和验证要求执行。

## 第一性原理与实施前提

Agent 需要可引用且可治理的资产；先验证持久化与隔离，再接执行能力。
保留 Provider draft / Tool active 及既有权限差异，不建设通用资产框架。
新增的日志隐藏行为必须明确展示，不能以“契约兼容”掩盖可见信息减少。
设计获确认后才把 04A Issue 标为 ready-for-agent。以下每个编号内按一项断言/一个小补丁推进，
每个 RED/GREEN 动作以约 2–5 分钟为粒度；耗时集成测试单独运行，不把整个接口当一个动作。

## 1. 配置与读取投影的纯函数接缝

新增 `apps/api/app/reference_asset_policy.py`、`apps/api/tests/test_reference_asset_policy.py`、
`netlify/functions/_shared/reference-assets/policy.ts`、`scripts/reference-assets-policy.test.mjs`、
`fixtures/reference-assets-policy.json`（全部为计划新增文件）。

1. 写 manual/MCP 空配置与 HTTP method/url 合法用例；分别运行下列命令，记录因模块/目标行为缺失的 RED。
2. 逐项添加未知字段、嵌套凭证、URL userinfo/query/fragment/IP/端口、null 与类型切换拒绝用例。
3. 添加确定性日志投影用例：非空哨兵隐藏、空值保持、metadata 白名单、未知事件保留位置、输入不被修改。
4. 最小实现 Python 与 TS 纯函数；同一 JSON fixture 覆盖两种实现；逐组转 GREEN。

```powershell
python -m pytest apps/api/tests/test_reference_asset_policy.py -q
npm test -- --run scripts/reference-assets-policy.test.mjs --maxWorkers=1 --no-file-parallelism
```

预期最终全部通过；不访问环境变量、DNS、HTTP 或数据库。fixture 不含真实凭证。

## 2. Python 接口防护与意图差异基准

修改 `apps/api/app/main.py`、必要的 `apps/api/app/schemas.py`；扩展
`apps/api/tests/test_tool_skill_assets_api.py`、`apps/api/tests/test_model_providers_api.py`。

1. 先写一个 unsafe create 的接口测试并观察 RED，再接入配置策略。
2. 同法覆盖 PATCH 最终组合、Provider null、历史配置读取 409；错误不得带原始 input。
3. 针对两类审计和调用列表逐入口增加摘要/metadata 哨兵；接入投影并验证数据库原值不变。
4. 增加 create/update/deactivate 成功审计同事务、冲突无成功审计、权限与跨 Workspace 回归。
5. 不改变真实执行接口或部署 Python；现有执行输出测试不得为迁移片擅自删减。

```powershell
python -m pytest apps/api/tests/test_reference_asset_policy.py apps/api/tests/test_tool_skill_assets_api.py apps/api/tests/test_model_providers_api.py -q
```

预期合法登记兼容，新增拒绝/隐藏行为按设计通过；新旧差异逐项记入契约 fixture，不能简单忽略字段。

## 3. 身份复用与 13 个 TypeScript 接口

新增 `netlify/functions/_shared/reference-assets/{routes,handler,postgres}.ts`、
`netlify/functions/reference-assets.mts`、`scripts/reference-assets.test.mjs`。
仅按需要修改 `netlify/functions/_shared/identity-workspace/{handler,postgres}.ts`，
提取已有身份帮助函数前先补身份回归，不复制 Session/CSRF/权限实现。

1. 写休眠 Function 返回 404、非法 Origin/CSRF/未登录拒绝的 RED，先封闭入口。
2. 按 Provider list/create/update/deactivate，再 Tool/Skill 四接口逐个 RED/GREEN。
3. 按 invocation list、两个 impact、两个 audit-events 逐个 RED/GREEN；不得以空数组占位。
4. 验证请求大小、限流、no-store、错误固定输出；成功写入与审计必须共事务。
5. 保持 `netlify.toml` 无新增生产路由，不新增云端启用变量。

```powershell
npm test -- --run scripts/reference-assets.test.mjs scripts/netlify-identity-workspace.test.mjs --maxWorkers=1 --no-file-parallelism
npm run typecheck:netlify
```

预期身份回归与新增 handler 契约均通过；休眠入口不可用不算迁移页面验收。

## 4. 隔离 PostgreSQL 与跨语言重放

新增 `scripts/test-reference-assets-postgres.mjs`、`scripts/reference-assets-contract-python.py`；
复用 `scripts/test-identity-postgres.mjs` 的显式 loopback 数据库模式和历史 baseline，不改已发布 migration。
不自动安装或启动数据库；执行前验证本机测试服务与依赖可用，否则明确记录阻断，不能换生产连接。

1. 为本次运行新建随机 schema，仅加载合成组织、成员、资产、草稿、版本、审计和调用记录。
2. 逐接口验证非空响应、重连持久化、过滤、排序、limit 边界与名称冲突。
3. 重放角色矩阵、跨组织/Workspace、失效成员、CSRF、非法配置及隐藏字段。
4. 用数据库直接断言失败回滚、成功审计、重复停用语义及并发重复创建只有一个成功。
5. Python/TS 输出归一化仅限随机 ID/时间；状态码、字段形状、默认值、错误与隐藏策略必须一致。
6. 清理只限本次显式创建的随机 schema；不得复用或清空既有 schema。

```powershell
node --experimental-transform-types scripts/test-reference-assets-postgres.mjs
node --experimental-transform-types scripts/test-identity-postgres.mjs
```

本机 Windows 5432 属于保留端口范围，恢复后的合成数据库映射在 127.0.0.1:55432：
资产脚本可传 `55432`；身份脚本可传 `apps/api/.venv/Scripts/python.exe 55432`。
这两个参数仅选择本机端口/测试解释器，不接受远程数据库地址。CI 仍使用默认 5432。

预期两个脚本均退出 0 并报告非零检查数量；SQLite 或 handler mock 不能替代这一步。

## 5. 隔离页面闭环

修改 `src/pages/AssetLibrary.tsx`、`src/pages/ModelProviders.tsx` 及各自 `.test.tsx`；
新增 `src/api/migrationCapabilities.ts`，只提供统一迁移模式，默认保持现有生产能力。
新增 `scripts/reference-assets-e2e-server.mjs`、`playwright.reference-assets.config.ts`、
`e2e/reference-assets.spec.ts`；独立配置不得复用现有 Python E2E 全局启动器。

1. 页面测试先断言迁移模式下测试调用/Provider 测试/草稿迁移不发请求，观察 RED，再禁用入口并解释原因。
2. HTTP 使用 method/url 字段；manual/MCP 空配置；补错误提示、隐藏提示与刷新状态测试。
3. impact/audit 请求失败清除旧显示并提示不可用，不能展示零影响面；403 审计不阻断列表。
4. 本地 E2E 服务器共用隔离身份与资产数据库；未迁移 API 固定 501，不代理 Zeabur。
5. 用合成用户完成登录→创建→编辑→刷新→停用；记录非空日志与影响面展示。
6. 浏览器断言没有外域请求和未支持 API 请求；检查可见表单与错误/隐藏提示。

```powershell
npm test -- --run src/pages/AssetLibrary.test.tsx src/pages/ModelProviders.test.tsx --maxWorkers=1 --no-file-parallelism
npm run test:e2e -- --config=playwright.reference-assets.config.ts
```

## 6. 完整验证与签收

策略/接口 mjs 测试使用 Vitest，与现有身份测试一致；验证现有 CI 分片确实发现新增测试。
修改 `.github/workflows/ci.yml` 接入新增 PG 重放，不能以 Vitest 代替数据库测试。
更新设计、Issue、项目总览和当前实现说明，记录实际命令、失败与最终证据。

```powershell
python -m pytest apps/api/tests -q
npm test -- --run --maxWorkers=1 --no-file-parallelism
npm run lint
npm run deploy:check
npm run build
git diff --check
```

此外重跑上列 Node、PG 和浏览器命令。逐项对抗审阅：任意 metadata 是否还有透传、隐藏是否伪装空值、
跨 Workspace 的历史引用是否可泄露、停用是否破坏快照、失败是否留下成功审计、页面是否调用旧 API。
工程完成不代表生产迁移完成。提交、推送和发布按届时明确范围执行；不得加入无关的
`.harness/wiki/research/`，不得覆盖已存在的加固发布回执。
