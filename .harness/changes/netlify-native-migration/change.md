---
id: H-20260904-01
status: executing
feature: .scratch/netlify-native-migration/
prd: .scratch/netlify-native-migration/PRD.md
issue: .scratch/netlify-native-migration/issues/01-platform-gate.md
design: docs/superpowers/specs/2026-09-04-netlify-native-migration-design.md
plan: docs/superpowers/plans/2026-09-04-netlify-native-migration.md
---

# 执行回执：验证 Netlify 原生运行时门禁

> 规格、AC 和状态以引用的 PRD/Issue 为准；本文件不得独立改写需求。

## 当前阶段

- 阶段：verify
- 下一门禁：补充 Preview 隔离/删除或失败不影响 Zeabur 的直接证据，并取得依赖审计结论。

## 影响面

- 前端：React/Vite 继续由 Netlify CDN 托管，浏览器刷新验证 `/login` 正常渲染。
- 后端：新增独立 Netlify Functions 平台健康、探针触发和状态查询入口。
- 契约/数据：新增 Netlify Database 探针表和 migration；现有业务表与 `/api/*` 契约未切换。
- 安全/隔离/审计：Async Workloads API key 仅由 Netlify 隐藏环境变量持有；GitHub 使用站点专用只读 deploy key；未读取或输出 Secret。
- 文档：补齐部署验证、执行回执、对抗式审查和本地 Issue 状态证据。

## RED / GREEN 证据

- RED：平台触发器模块缺失、重复事件会重复完成、失败模拟不抛错的针对性测试曾失败。
- GREEN：补充触发器、业务幂等 claim 和同事件重试后，针对性测试通过；全量 51 个测试文件、296 项测试通过。
- 不适用说明：Preview 删除/失败隔离仍缺直接演练证据，因此本 Issue 保持 `in-progress`。

## 验证证据

| 命令或检查 | 结果 | 说明 |
|---|---|---|
| GitHub push | 通过 | `0a49e09` 已推送到 `petr1chorL/arc` 的 `codex/harness-governance` |
| Netlify Git build | 通过 | Deploy `6a9a3b9aea2344440fd14328` 构建提交 `0a49e09f31788b11d21cd4f8afacae18c0522f5c` |
| `/login`、`platform-health`、`/api/health` | 通过 | 均返回 200；刷新后的登录页无残留 Origin 错误 |
| Async Workloads router | 通过 | 未携带内部认证访问返回 401，而非部署缺失时的 404 |
| 幂等探针 | 通过 | `platform-gate-idempotency-v1` 完成且 `attempt_count=1` |
| 失败重试探针 | 通过 | `platform-gate-retry-v1` 第 2 次尝试完成 |
| 一次性触发保护 | 通过 | 第二次 POST 返回 `already-triggered` |
| 本地质量门禁 | 通过 | 51 个测试文件、296 项测试、lint、Netlify typecheck、build 通过 |
| `npm audit` | 无结论 | npm advisories 网络连续超时，需后续重试 |

## 遗留人工动作

- Preview 隔离/失败或删除演练涉及云端 Preview 生命周期操作，尚未执行。
- 在业务数据和 API 切换完成前不得关闭 Zeabur。
