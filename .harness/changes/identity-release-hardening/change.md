---
id: H-20260905-01
status: ready-for-human
feature: .scratch/identity-release-hardening/
prd: .scratch/identity-release-hardening/PRD.md
issue: .scratch/identity-release-hardening/issues/01-hardening.md
design: docs/superpowers/specs/2026-09-05-identity-release-hardening-design.md
plan: docs/superpowers/plans/2026-09-05-identity-release-hardening.md
---

# 执行回执：身份约束与发布门禁

阶段：ready-for-human（工程、Preview 和生产发布验证通过；业务未切流）。实现提交 `ba35010730b14760267800a00751c4df3bbe238d`
已通过 PR #39 合入 `codex/harness-governance`，生产合并提交为 `b56b991ba98068b0a7af4f16eeee3fd6674d0ebb`。
Netlify Deploy `6a9b5d59a62aa90007f4be38` 已发布，精确 SHA CI 与无凭证生产冒烟通过；
身份 Function 仍休眠，Zeabur 仍承载业务。下面保留 Preview 阶段记录，当前证据见 verify.md 顶部。

## 影响面

- Python/TS 成员写事务和全局 User 停用约束。
- TS 请求体/Cookie/受信客户端持久限流；不改变现有 JSON 字段。
- GitHub codex 分支 CI 与 Netlify 精确 SHA 发布门禁。
- PostgreSQL 合成测试与 Python/TS 最小契约重放。
- Issue 04 拆分及事实入口修订；无 UI、业务数据或生产路由修改。

## RED / GREEN

- Python 原有全局停用返回 200（期望 409）；修复后成员回归通过。
- TS 超大正文返回 200、损坏 Cookie 返回 503；修复后相关测试通过。
- TS 跨 Workspace 停用原本成功、客户端超限仍做认证；新失败测试复现后转绿。
- 新发布门禁先因模块缺失失败，随后 13 项失败关闭规则通过。
- 全量回归发现旧 Netlify 测试仍断言只有 npm run build，更新为新的门禁命令后通过。

详见 verify.md；后续 cc98029 已通过 PR #39 的独立 Preview 验收，生产验收不标为通过。

工程验证已通过：前端 333、后端 410、真实 PostgreSQL 129 项检查；CI run 33928026353 success。
生产合入/部署随后已完成，API 切流仍是后续步骤，不能据此关闭 Zeabur。

Preview Deploy `6a9b54d034fa00000853068e` 对齐 cc98029；云端精确 SHA 门禁、页面、
静态资源、未认证路由和数据库健康检查通过，身份 Function 仍休眠。PR #39 随后经用户授权合并。
