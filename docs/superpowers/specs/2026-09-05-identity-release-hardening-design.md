# 身份约束与迁移发布门禁

用户于 2026-09-05 接受整体审查后的优先修复建议。本切片不切生产 API，不迁移真实数据，不关闭 Zeabur。

## 第一性原理与范围

User 停用影响其全部 Workspace，不能用请求 URL 的局部成员角色推断影响面。
管理员不变量是：一次操作不能把原本存在的有效非组织 Workspace 管理员全部移除。
有效管理员必须同时满足 User active、Membership active、workspace_admin、非组织管理员。
组织管理员不计入该不变量；停用非有效管理员不应被错误阻止。

Python 与 TypeScript 在成员写操作中锁定同一 Organization 行，再读取成员与管理员计数，
事务提交前持有锁。PostgreSQL 使用 FOR UPDATE；SQLite 用无值变化 UPDATE 取得写锁。
这是低频管理操作的保守串行化，不扩展到运行/资产请求，不声称解决全部身份并发竞争。
User 全局停用逐个检查其有效管理员成员关系，失败时不得修改 User、撤销 Session 或写成功审计。

Netlify Handler 限制请求体为 1 MiB，包括缺失或伪造 Content-Length 的流式正文。
仅解析 Session Cookie；损坏编码当作无有效 Session，不因无关 Cookie 返回 503。
持久请求限流在业务事务前独立提交，按受信客户端地址计数，失败请求也消耗额度。
不信任调用方提供的 X-Forwarded-For。额度默认 120 次/60 秒，邀请既有更严限制保留。

CI 覆盖 codex/** push 与迁移生产分支 PR。Netlify 发布构建等待精确 COMMIT_REF 对应
GitHub CI push workflow 成功；缺失、失败、超时或读取异常都阻断新发布，既有部署不受影响。
公开 GitHub API 只读检查，不新增 Token。Preview 同样需要源分支 SHA 的 push CI。

## 验证与边界

先以失败测试固定跨 Workspace 停用、请求体和 Cookie 缺陷；再补 PostgreSQL 合成集成测试、
失败回滚和并发管理员移除测试。集成工具只接受明确隔离的本地测试数据库，不连接生产。
前后端测试、lint、deploy:check、build 必须新跑。GitHub/Netlify 真正发布门禁必须以线上
同 SHA 结果独立验收；没有实际执行的验证不得写成通过。

## 对抗式检查

- 两个管理员并发降级不能同时成功；组织锁之前不能先锁目标成员而产生反向锁序。
- 当前 Workspace 是 builder 不得绕过另一 Workspace 的最后管理员保护。
- 已停用用户/组织管理员不计数，也不应被错误计为被移除的有效管理员。
- CI 只按 branch 匹配不够，必须精确 SHA、workflow、event 和最终 conclusion。
- 本切片不是全量身份契约迁移验收，也不修运行队列、演示指标或 UI 性能。
