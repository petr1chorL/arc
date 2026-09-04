---
id: H-20260904-01
status: done
feature: .scratch/netlify-native-migration/
prd: .scratch/netlify-native-migration/PRD.md
issue: .scratch/netlify-native-migration/issues/01-platform-gate.md
design: docs/superpowers/specs/2026-09-04-netlify-native-migration-design.md
plan: docs/superpowers/plans/2026-09-04-netlify-native-migration.md
---

# 执行回执：验证 Netlify 原生运行时门禁

> 规格、AC 和状态以引用的 PRD/Issue 为准；本文件不得独立改写需求。

## 当前阶段

- 阶段：closed
- 下一门禁：Triage `issues/02-schema-and-data-rehearsal.md`，明确非生产 schema baseline、导入与对账边界。

## 影响面

- 前端：React/Vite 继续由 Netlify CDN 托管，浏览器刷新验证 `/login` 正常渲染。
- 后端：新增独立 Netlify Functions 平台健康、探针触发和状态查询入口。
- 契约/数据：新增 Netlify Database 探针表和 migration；现有业务表与 `/api/*` 契约未切换。
- 安全/隔离/审计：Async Workloads API key 仅由 Netlify 隐藏环境变量持有；GitHub 使用站点专用只读 deploy key；未读取或输出 Secret。
- 文档：补齐部署验证、执行回执、对抗式审查和本地 Issue 状态证据。

## RED / GREEN 证据

- RED：平台触发器模块缺失、重复事件会重复完成、失败模拟不抛错的针对性测试曾失败。
- GREEN：补充触发器、业务幂等 claim 和同事件重试后，针对性测试通过；全量 51 个测试文件、296 项测试通过。
- Preview RED：临时分支上的隔离测试先因 marker migration 不存在而以 `ENOENT` 失败。
- Preview GREEN：加入仅插入唯一探针标记且无 `DELETE`/`DROP`/`TRUNCATE` 的 migration 后，聚焦测试 1 项、临时分支全量 52 个文件/297 项测试通过。

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
| Deploy Preview 数据隔离 | 通过 | PR #36 / Deploy `6a9a3fbe65b65a00081b37b0` 的 Preview 有唯一标记，Production 无该标记 |
| Preview 生命周期清理 | 通过 | PR、临时分支和 Preview deploy 已删除；Preview URL 404，生产与 Zeabur 健康检查仍为 200 |
| 本地质量门禁 | 通过 | 51 个测试文件、296 项测试、lint、Netlify typecheck、build 通过 |
| `npm audit` | 无结论 | npm advisories 三次网络断开/超时；不把无结论写成通过 |

## 遗留边界

- 平台门禁已关闭；依赖审计仍需在 npm advisories 可用时重试。
- 在业务数据和 API 切换完成前不得关闭 Zeabur。
