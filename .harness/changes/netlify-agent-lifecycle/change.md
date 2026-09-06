# 04B Agent 生命周期迁移

Status: ready-for-human
Owner: Python / TypeScript / React

用户已确认状态/空值/地址兼容规则，允许本地实现；不包含生产发布、真实数据清洗或模型外呼。
设计：`docs/superpowers/specs/2026-09-05-netlify-agent-lifecycle-design.md`。
计划：`docs/superpowers/plans/2026-09-05-netlify-agent-lifecycle.md`。

- [x] Python 目标契约与历史保护通过。
- [x] 八条 TS 治理路由、同库 PG、共享请求通过。
- [x] 角色/引用/并发/失败回滚通过。
- [x] 页面与浏览器完整治理路径通过，无运行外呼。
- [x] 全量回归和对抗审查通过，文档与 Issue 更新。

第一性原理：发布可追溯定义而非执行模型；必须在同库完成权限、依赖锁定、快照和审计。
对抗门禁：不得以创建成功代替全生命周期、以缓存快照代替持久化证据、以按钮禁用代替服务端边界。
