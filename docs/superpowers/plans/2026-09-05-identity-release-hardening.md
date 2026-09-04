# 实施计划：身份与发布收口

1. 在 apps/api/tests/test_membership_api.py 增加跨 Workspace User 停用测试；红灯后修改
   apps/api/app/routers/workspaces.py 的全局保护与成员写事务锁；重新运行成员测试。
2. 在 scripts/netlify-identity-workspace.test.mjs 固化 HTTP 边界缺陷；修改
   netlify/functions/_shared/identity-workspace/handler.ts，复测精确状态与 backend 未调用。
3. 修改 postgres.ts 的全局管理员保护、组织锁、持久客户端限流；增加隔离 PG 合成集成脚本。
4. 为 scripts/verify-ci-release.mjs 先写失败测试，再实现精确 SHA 的失败关闭门禁；
   更新 .github/workflows/ci.yml、netlify.toml，保留生产代理与休眠函数。
5. 执行相关测试、全量前后端测试、lint、deploy:check、build；回写验证与未完成边界。
6. 将 Issue 04 拆为依赖资产、Agent、Workflow、其余治理资产等纵切；修订当前事实入口。

无可用 Superpowers 技能入口，按项目已有设计/计划/TDD流程落文档，不宣称调用了该技能。
