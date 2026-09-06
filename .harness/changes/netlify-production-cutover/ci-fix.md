# Workflow CI 失败诊断与修复回执

日期：2026-09-06。范围：GitHub CI `34013885627` 的 Workflow 浏览器门禁失败。
不包含生产装配、迁移、凭证、备份、切流、Zeabur 退役或新的 CI 成功声明。

## 可复现根因

原 CI 报 `versions.map is not a function`。版本读取增加 HTTP 状态断言后，在现有完整
9 项浏览器门禁中复现 **HTTP 429**，正文 `{"detail":"请求过于频繁，请稍后再试"}`。
结果为 8 passed / 1 failed（22.7s）。不是版本响应数组契约发生变化，也不是缺失快照。

Workflow 在多次刷新和 React StrictMode 场景中加载量规目录，失效 effect 在初始目录解析后
仍继续为每条量规发版本请求。它与正常页面/API 验证请求一起消耗同一客户端 120 次/分钟配额；
执行速度/被浏览器取消的请求是否到达服务端决定是否触发最后一次 429。
Agent 目录已在相同位置检查 active；量规目录只有全部版本返回后的检查。

单跑另外确定复现：原禁止请求正则把 `/src/api/notifications.ts` 静态模块当成通知 API。

## 最小修改

- `src/pages/Workflows.tsx`：初始量规/Provider 目录返回后、子版本请求之前增加 isActive guard。
- `src/pages/Workflows.test.tsx`：延迟目录响应，在 effect 卸载后释放，断言没有版本子查询。
- `e2e/workflow-governance.spec.ts`：版本响应先断言 HTTP 200；禁止执行判断限于同源 `/api/`
  路径，外域仍全部禁止，静态模块不再误判。
- 同日设计、实施计划与本地 07a Issue 记录边界及新证据。

没有提高限流、修改 IP 标识、添加自动重试、吞掉错误、删验收断言或修改生产配置。
临时合成 HTTP 错误探针已清理，`reference-assets-e2e-server.mjs` 无内容 diff。

## 新验证

数据库：主线程提供的 `arc-one-cutover-verify-20260906`，loopback 55433 合成隔离库；未停容器。

| 检查 | 结果 |
|---|---|
| 聚焦卸载/延迟目录测试（实现前） | RED，仍请求 `/evaluations/rubrics/rubric-quality/versions` |
| `node node_modules/vitest/vitest.mjs run src/pages/Workflows.test.tsx` | 56 passed，14.12s |
| `ARC_ONE_TEST_PG_PORT=55433` + Playwright reference-assets config | 9 passed，23.5s |
| 隔离数据库清理 | Playwright teardown 独立确认随机 schema 已删除 |
| `npm run lint` | pass |
| `npm run build` | pass（已有 >500kB chunk 提示） |
| `git diff --check` | pass |

## 对抗式审查

- 错误对象不会再在 map 处掩盖真正状态码；非 200 必须阻断测试。
- 静态模块排除不放宽 `/api/.../runs`、`test-runs`、`human-tasks`、`notifications` 禁止规则。
- 限流、认证、CSRF、Workspace 隔离与生产代理无修改。
- 此修复阻止无效 effect 的请求放大，**不等于**消除所有目录 N+1，也不能说明大规模目录永不触发限流。
- 这是新的本地证据；需主线程 review、提交推送及精确 SHA 云端 CI 后才能解除发布门禁。
