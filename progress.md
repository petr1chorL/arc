# ARC.ONE 规划进度

## 2026-06-25

- 阅读 `CONTEXT.md`、项目工作流、当前实现和项目建设蓝图。
- 检查 `.scratch` 中 Agent、工作流、真实执行与人工协作 Issue 状态。
- 确认 V0.6 主链路已有实现和测试，但多个 Issue 仍待人工验收。
- 识别项目总蓝图的当前状态章节已经过期。
- 建立从 V0.6 收口到 V1.0 的 8 阶段计划。

下一步：完成人工验收收口，并为“真实试点场景与评估闭环”建立 PRD 和 Issues。

### V0.7 设计会话

- 确认本地账号优先，并预留 OIDC/飞书 SSO。
- 确认单组织、多 Workspace、多成员边界。
- 确认固定平台角色与独立审核资格。
- 确认邮箱密码、HttpOnly Session Cookie 和邀请激活方式。
- 确认默认 Workspace 迁移与资产隔离。
- 确认单一平台角色、逐级权限矩阵和独立审核资格。
- 确认平台级不可修改审计事件范围。
- 确认 V0.7 拆分为 V0.7A 身份权限和 V0.7B 治理策略。
- 确认方案 A：FastAPI 应用内身份与权限模块，预留 OIDC。
- 确认认证架构、核心数据关系、管理界面和安全测试边界。
- 用户批准 V0.7A 整体设计。
- 正式设计写入 `docs/superpowers/specs/2026-06-25-v0.7a-identity-access-design.md`。
- 确认 V0.7A 只生成可复制激活链接，不引入邮件发送服务。

下一项：用户复核正式设计文档，确认后进入实施计划。

### V0.7A 实施计划

- 已开始映射后端模型、Schema、服务、路由、前端 API、路由和测试文件。
- 确认认证、授权和审计需拆成独立模块，避免继续扩张 `main.py`。
- 实施计划写入 `docs/superpowers/plans/2026-06-25-v0.7a-identity-access.md`，
  按 10 个串行 Task（含 Task 0 项目管理）覆盖安全原语、认证、迁移、RBAC、前端、
  成员、Reviewer、审计和 E2E。
- 计划自检完成：10 个 Task（含 Task 0 项目管理）、64 个可跟踪步骤、9 个代码提交点。
- 修正 CSRF 设计为 HttpOnly Session Cookie + 可读 CSRF Cookie + 请求头摘要校验。

下一项：选择 Subagent-Driven 或 Inline Execution 开始实施。
