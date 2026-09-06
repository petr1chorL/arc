# Provider 两端点独立审查

日期：2026-09-06。本审查只读实现，仅写回执；不访问生产、凭证或真实存在性适配器。
范围：reference-assets 的两个新增路由、handler/postgres 接线、provider-compat-postgres、对应测试，
对照旧 main.py migrate-drafts/test、schemas.py ModelProviderDraftMigrationCreate，追踪 Agent/Provider 锁。

## 当前结论

主要安全边界与旧业务语义接线正确；初审发现的边缘输入契约差异及并发验证证据不足均已修复/补证，
并经独立复审确认。当前未解决阻断问题0。未将两个端点的本地实现解读成生产Secret绑定或页面启用完成。

## Spec 轴

- 旧迁移“草稿”指 agents 当前可编辑记录，旧 Python 没有 status=draft 过滤；本实现迁移当前编辑面
  包括已发布 Agent 的编辑面，符合旧语义。只更新5个运行模型/时间字段，不写 agent_versions、workflow_versions。
- Source/Target 同 Workspace、目标不可 disabled、允许从 disabled Source 迁出、reason/目标参数限制、
  响应 camelCase 字段及成功审计 metadata 对齐旧契约。
- test 的旧 ready 只意味着 Secret 配置存在，不是实际模型网络连接；新默认 missing_secret 且无外呼。

### [P2] Unicode 空白校验与旧 Python 不等价（已修复）

`migrationPayload` 使用 JS trim，旧 schema 使用 Python str.strip。独立本地验证 U+0085：
Node trim 后长度1，Python strip 后长度0。只含该空白的 reason 新实现会接受而旧实现422；
被该字符包围的 target ID 新实现也不会正常化成旧契约的ID。
应使用仓库已有 Python-compatible strip 并添加对应输入测试。

## Standards 轴

- Origin 由 handler 在业务数据库前校验；workspaceContext 验证 Session/CSRF/Workspace；agent.write
  和同 Workspace Provider 查询在 secretPresence 调用之前，未授权请求不触达存在性端口。
- 回调只接收 Workspace/Provider/SecretRef/BaseURL，只有严格 boolean true 才返回 ready；缺省为missing，
  异常统一503不泄露错误内容。不安全历史 URL/Ref 先409，不把原值带入失败正文。
- Source/Target Provider 使用按ID排序的 FOR SHARE，冻结配置；Agent 使用 FOR UPDATE 后按精确ID更新。
  Agent 发布/更新的 Agent→Provider SHARE 与此共享锁兼容；Provider普通编辑仅锁Provider，不再反查Agent。
- 更新与成功审计同事务，审计失败整体回滚；没有新平台环境读取、传输、schema或公开入口变化。

## 初审并发证据不足（已补证）

当前“并发迁移1/0”两请求使用同一 cookie；既有 authenticate 对 Session FOR UPDATE，会在进入
Provider/Agent锁之前串行化。因此该测试证明同Session重复提交安全，但不能证明跨Session锁序或
迁移与Agent发布/更新交错安全。需增加独立Session和可控交错的验证，并避免回执夸大覆盖范围。

## 独立验证

`ARC_RUNTIME_TEST_PORT=55433` + `node --experimental-transform-types scripts/provider-compat.test.mjs`：
4 passed / 0 failed，2.51s。随机 schema 自清理，容器未停止。
上述测试通过不覆盖所列 Unicode 与跨Session并发缺口。

未评价：真实 SecretRef 允许绑定、公开 Function 装配、前端按钮、实际模型连接、AWL、生产切流。

## 修复后独立复审

- migrationPayload 已复用既有 Python-compatible strip；NEL、U+001C–1F、包围ID和BOM差异有真实HTTP测试。
- 两个独立Session迁移在各自均取得Provider SHARE后通过屏障继续，证实不是Session行锁先串行化。
- 独立Session发布/迁移两个先行方向分别停在Agent锁，pg_blocking_pids确认后行真实等待后才释放；
  发布先行快照保留source，迁移先行快照使用target，历史version-a始终不变，最终编辑面target且两项审计存在。
- 独立再次运行完整Provider兼容脚本：**7 passed / 0 failed，4.73s**；不再将原同Session测试当作跨Session证据。

结论：限定两端点切片可以进入主线程整合/CI；不表示真实Secret接线和生产迁移完成。
