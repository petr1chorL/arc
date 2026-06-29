# V0.30G 验收记录：Notification Ops View

## 第一性原理

- 通知运维的最小真实问题不是“再做一个看板”，而是让运维人员看到当前 Workspace 中哪些通知事实需要处理。
- 因此本版本只保留三个必要对象：Notification Outbox 记录、可筛选的状态/渠道/失败码、能解释失败的错误证据。
- 页面必须接入 V0.30F 的真实查询 API；不能用静态演示数据制造已经完成通知运营闭环的错觉。

## 对抗式审查

- 本页面是只读查询面板，不提供发送、批量重试、真实外部渠道或告警能力，避免把“可看见”误报成“可恢复”。
- 页面通过 Workspace 上下文调用 `/api/workspaces/{workspaceId}/notifications/outbox`，没有硬编码 Workspace ID。
- 失败通知同时展示稳定 `errorCode` 与人类可读 `error`，避免后续排障只能解析文案。
- 测试覆盖了筛选请求、失败证据、空结果、接口错误和侧栏入口，不只覆盖快乐路径。

## 已实现

- 新增 `src/api/notifications.ts`，封装 Notification Outbox 查询，并支持 `status`、`channel`、`errorCode` 与 `limit`。
- 新增 `src/pages/Notifications.tsx`，展示通知摘要、筛选栏、通知列表、空态、加载态和错误态。
- Workspace 路由新增 `/w/:workspaceSlug/notifications`，并保留 legacy `/notifications` 重定向。
- 侧栏新增“通知运维”入口与页面标题映射。

## 本版本不包含

- 不新增批量重新入队。
- 不新增单条通知详情页。
- 不新增真实外部渠道。
- 不新增后端接口。
- 不新增告警发送能力。

## TDD 证据

- RED：`npm run test -- src/api/notifications.test.ts src/pages/Notifications.test.tsx src/components/Layout.test.tsx --run` 在实现前失败，因为 API 模块、页面和导航入口尚不存在。
- GREEN：同一命令在实现后通过，3 个测试文件、10 条测试用例全部通过。

## 最终验证

- `npm run test -- src/api/notifications.test.ts src/pages/Notifications.test.tsx src/components/Layout.test.tsx --run`：通过，3 个测试文件、10 条测试用例。
- `npm run lint`：通过。
- `npm run build`：通过；Vite 报告单个 chunk 超过 500 kB 的既有体积提示，不阻断构建。
- `git diff --check`：通过；仅提示部分工作区文件未来被 Git 触碰时会从 LF 转 CRLF。
- `Invoke-WebRequest -Uri http://127.0.0.1:4173/w/ai-capability-center/notifications -UseBasicParsing`：返回 HTTP 200。
- 浏览器无头验证尝试使用 Playwright，但本机缺少 `chromium_headless_shell` 可执行文件，未作为通过证据记录；界面行为由 Testing Library 组件测试覆盖。
