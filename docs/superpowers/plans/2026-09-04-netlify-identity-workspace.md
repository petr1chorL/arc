# Netlify 身份与 Workspace 纵切实施计划

## 1. 固定契约与安全原语

- 为 route 白名单、JSON 验证、Cookie、Origin、Token digest、Argon2 兼容和能力矩阵先写 RED 测试。
- 增加 `hash-wasm` 精确直接依赖，并用 Python Argon2 PHC 测试向量证明跨语言兼容。
- 实现最小 HTTP/security/RBAC 模块，聚焦测试转绿。

## 2. 身份与邀请 TDD

- 先为登录成功/失败/锁定、Session idle/absolute 过期、CSRF、logout、改密全撤销写 RED 场景。
- 用可注入 repository 实现 Auth handler，再接入 Netlify Database transaction。
- 先为 invitation preview/activate、过期/撤销/已使用和持久限流写 RED 场景，再实现。

## 3. Workspace、Membership、RBAC 与 Audit TDD

- 先固定 Workspace list/create/detail 和组织/Membership 隔离。
- 再固定成员、邀请、角色、Membership/User 启停、Reviewer 资格、最后管理员保护和权限拒绝。
- 最后固定审计写入、过滤与 camelCase 响应；每个 RED 场景只实现足够代码使其转绿。

## 4. 精确路由与本地质量门禁

- 为每个已实现端点在 `netlify.toml` 增加位于 Zeabur catch-all 之前的精确路由。
- 增加配置测试，证明未迁移的 Agent/Workflow API 不被 Function 捕获。
- 运行 Netlify typecheck、前后端相关/全量测试、lint、build、deploy:check 和 diff check。

## 5. 隔离 Preview 演练

- 创建 `codex/netlify-identity-workspace` 临时分支和 Preview-only 合成 seed migration。
- 创建临时 PR，等待 Deploy Preview ready；用固定虚构账号完成 API 与浏览器冒烟。
- 核验 Cookie/CSRF、Workspace 进入、成员邀请激活、权限拒绝、审计，以及未迁移 API 的 Zeabur 路由。
- 关闭 PR，删除 Preview deploy/临时分支；确保 seed 未进入 Production。

## 6. 提升与收尾

- 只提交永久 Function、精确路由、测试、设计、计划与验证证据到生产分支。
- 等待 Production deploy；验证无数据登录为 401、本切片健康、剩余 API 仍代理 Zeabur。
- 更新 Issue、项目事实、Harness 回执和迁移状态；Zeabur 保持在线，下一项进入 Issue 04。
