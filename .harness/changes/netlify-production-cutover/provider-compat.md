# Provider 原生兼容切片

Status: ready-for-human（窄切片已实现，待主线程整合审查）；不代表 07 生产迁移完成。

依据：同日切流设计/计划、readiness-review，以及旧 main.py 的 migrate-drafts/test。
底层目标是切流后保留管理员已存在的配置治理能力，不新增联网或生产 Secret 探测。

设计与计划：
1. 在 reference-assets 内补两条路由，共用真实 Session、CSRF、Workspace 与 agent.write。
2. 草稿指 agents 可编辑记录，包含已发布 Agent 的当前编辑面；不能修改 agent_versions。
   同 Workspace 查找两个 Provider，目标非 disabled；锁定记录并在同一事务内迁移及审计。
3. test 只注入 boolean 存在性端口，默认 missing_secret；不访问环境变量或调用网络。
4. 先写一条真实 PostgreSQL HTTP 红测试，再实现，扩展失败、权限、回滚和固定版本测试。

AC：旧 camelCase 响应；reason 校验；同源/跨 Workspace/能力；事务审计；不可变版本；
配置检查不返回 secret；缺失 resolver 不误报 ready。

## 根因与契约

两个旧 Python 端点在 reference-assets resolver 中被显式排除，因此原生请求返回 404。
现已补路由与事务处理，沿用旧 camelCase 响应；迁移请求也接受 snake_case target_provider_id，
拒绝空白/超长 reason、额外字段、同源目标、跨 Workspace 和 disabled 目标。
源 Provider 可以 disabled（用于迁出）；只更改 agents 当前编辑面，不更改 Agent/Workflow 固定版本。
只在原有迁移成功处写 model_provider.migrate_drafts 审计，Provider test 不新增旧契约不存在的成功审计。

新增可选 `createPostgresReferenceAssetsBackend(pool, { secretPresence })`：
端口接收 workspaceId/providerId/secretRef/baseUrl，只返回 boolean，不获得 secret 值。
默认返回 missing_secret；返回严格 true 才给旧 ready 配置响应。异常统一 503，不回显 resolver 错误。
历史不安全 Provider URL/SecretRef 在调用该端口前 409，延续原生资产历史治理边界。

## 新验证证据（2026-09-06）

- Red：`node --experimental-transform-types scripts/provider-compat.test.mjs`
  分别观察配置检查与迁移 HTTP 404 != 200；使用 `ARC_RUNTIME_TEST_PORT=55433` 合成数据库。
- Green：相同命令 4 组测试全部通过，约 2.40 秒；每组使用随机 schema，finally 清理并确认不存在。
  覆盖真实 Session/CSRF/Origin/RBAC、两个 Workspace 均为成员时的隔离、布尔端口输入、
  不安全历史值/异常脱敏、不可变版本、并发请求恰一次迁移、审计失败整笔回滚。
- `npm run test -- --run scripts/reference-assets.test.mjs`：25 项通过（797ms）。
- `npm run lint`、`npm run typecheck:netlify`、`npm run build`：通过。
  初次 Vite 测试/构建遭沙箱 spawn EPERM，经批准的本地子进程运行后通过；不是业务失败。

## 对抗式审查

Provider 使用 FOR SHARE 冻结配置，避免与 Agent 发布/更新的 Agent→Provider 锁形成反向独占锁循环；
选中 Agent 行 FOR UPDATE 后按确切 ID 更新，审计与编辑同事务。并发同源迁移实际结果为 1/0，
不会把已迁出的记录再次计算成功。注意：首轮并发请求使用同 Session，被身份层 Session 行锁串行化，
该证据只证明请求幂等结果，不能单独证明 Provider/Agent 锁并发；下节补充独立 Session 证据。
不把 Agent 的 published 编辑面状态当成发布版本本身。
不新增网络、Secret 环境读取、数据库迁移、前端按钮启用、公开 Function 或生产代理变更。
真实 Secret 存在性绑定和页面启用由生产 composition/迁移能力切片整合；本报告不代表线上完成。

## 独立审查后的修正与补证

1. migrationPayload 原用 JavaScript trim，与 Python str.strip 的 Unicode 空白集合不等价。
   新增红测试观察 reason=U+0085 得到200、期望422；改为复用 rubrics/policy.ts 已有 Python-compatible strip。
   验证 U+0085、U+001C/U+001D/U+001E/U+001F 空值拒绝、包围 target/reason 被裁剪；BOM 不裁剪，
   BOM-only reason 保留、BOM 包围目标保持找不到404。仍在裁剪前检查 Python 字符数长度限制。
2. 新增第二个真实登录 Session，先验证两份 Cookie 不同。两个迁移事务在各自已持有 Provider SHARE
   锁后通过屏障再竞争 Agent 行，得到 migratedCount=1/0；不再依赖单 Session 串行化说明并发安全。
3. 独立 Session 的 Agent publish 与 Provider migrate 两种交错：先行者持有 Agent FOR UPDATE，
   后行者发出实际 SQL，用 pg_blocking_pids 确认数据库等待，再释放屏障。发布先行得到旧 Provider
   固定快照、迁移先行得到新 Provider 固定快照；两种情况下编辑面最终新 Provider，既有版本均原样。
   第一种交错同时确认迁移已持 Provider SHARE，再等 Agent，不产生发布的反向独占死锁。

最终定向证据：`ARC_RUNTIME_TEST_PORT=55433 node --experimental-transform-types scripts/provider-compat.test.mjs`
7 passed / 0 failed，4.819 秒；`npm run lint`、`npm run typecheck:netlify` 通过。
此轮行为变更仅 Python-compatible strip；竞争测试增强证据，没有改写生产锁规约或新增网络。
