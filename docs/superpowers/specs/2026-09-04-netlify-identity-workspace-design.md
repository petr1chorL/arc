# Netlify 身份与 Workspace 纵切设计

## 决策

在一个 Netlify TypeScript Function 中实现身份、邀请和 Workspace 管理纵切。Deploy Preview
临时通过位于 Zeabur catch-all 之前的精确路由规则接管流量；Production 在真实身份数据导入并
对账前只部署休眠 Function，不提升路由，全部 `/api/*` 保持现有 Zeabur 代理。

这不是前端登录页重做。现有 React API 调用、字段名和错误处理保持不变，迁移边界位于服务端。

## 契约范围

- Auth：login、session、logout、change-password。
- Invitation：preview、activate。
- Workspace：list、create、detail、audit-events、permissions/matrix。
- Membership：list、invite、copy/resend/revoke invitation、role update、Membership/User enable/disable。
- Reviewer：grant/update、revoke。

响应继续使用现有 camelCase 字段，错误继续使用 `{ "detail": string | validation[] }`。角色仅允许
`viewer`、`operator`、`builder`、`workspace_admin`。

## 运行结构

- `netlify/functions/identity-workspace.mts`：唯一 HTTP 入口，只解析请求原始 pathname 的白名单
  route 和方法；不信任调用方提供的 route 查询参数。
- `netlify/functions/_shared/identity-workspace/`：HTTP、Cookie、安全、数据库访问、RBAC、审计与
  handler；核心 handler 支持依赖注入，单元测试不连接生产数据库。
- `@netlify/database`：每次请求内获取数据库；多表写操作使用同一个 pool client 和事务。
- `hash-wasm`：验证并生成与 Python `argon2.PasswordHasher` 兼容的 Argon2id PHC 字符串；
  Token 使用 Web Crypto 生成并只存 SHA-256 摘要。

## 路由隔离

不使用 `/api/workspaces/*` 宽泛转发。Preview 分支为每个本切片端点声明精确规则，规则排在
`/api/* -> Zeabur` 之前；Function 再次校验请求原始 pathname，直接访问函数路径、伪造 query
route 或未知 route 返回 404。Preview 证据固定到 deploy ID，验证后从生产候选提交移除这些规则。

## 身份与安全语义

- 登录按 normalized email 限定 active Organization；重复命中视为认证配置异常。
- 错误密码累计失败次数，第 5 次锁定 15 分钟；未知邮箱执行 dummy Argon2 verify。
- Session Cookie 为 `arc_one_session`、HttpOnly、Secure、SameSite=Lax、Path=/；CSRF Cookie 为
  `arc_one_csrf`、可读、Secure、SameSite=Lax、Path=/；绝对有效期 7 天，idle 8 小时。
- 写请求比对 `X-CSRF-Token` 摘要；登录与邀请接口执行 same-origin 检查。
- logout、改密、用户停用和 Session 失效写入撤销原因；改密撤销该用户全部 Session。
- Invitation preview/activate 的限流改为数据库内持久计数，避免无状态 Function 实例内存限流失效。

## Workspace、RBAC 与审计

组织管理员可访问所属 Organization 的全部 active Workspace；其他用户必须存在 active Membership。
能力矩阵沿用当前 `ROLE_LEVEL` 与 `CAPABILITY_MIN_ROLE`。拒绝时返回原有 403/404 语义并记录审计，
避免泄露其他 Workspace 是否存在。

成员、邀请和 Reviewer 写操作在事务中执行。最后一名有效非组织管理员 Workspace Admin 不得被
降权或停用；用户不能停用自己的 Membership/User。审计行同时填充现表的兼容字段，查询响应不
暴露 Session token、CSRF digest、password hash 或 invitation digest。

## Preview 验证与发布

1. 临时分支添加 Preview-only migration，创建固定 `.invalid` 邮箱、测试密码摘要、Organization、
   Workspace 与 Membership。
2. Deploy Preview 使用独立数据库分支；运行 API 契约和浏览器登录/Workspace 冒烟。
3. 覆盖 Session/CSRF、角色拒绝、邀请激活和审计；确认非白名单业务 API 仍到 Zeabur。
4. 固定 Preview deploy ID 后移除临时 seed、冒烟脚本和路由；只提升休眠实现与限流表。
5. Production 的 `/api/auth/session` 仍由 Zeabur 响应；Function 直连返回 404，证明未提前切流。

## 回滚与完成边界

最终路由切换将在 Issue 07 以版本化 `netlify.toml` 原子提交；回滚到上一 deploy 即恢复 Zeabur
catch-all。若 Preview 任一契约或隔离检查失败，不发布实现。本 Issue 完成只证明身份与 Workspace
纵切具备迁移实现和隔离证据，不代表生产身份数据或流量已迁移，不能关闭 Zeabur。
