# V0.21E 审计筛选同步 URL 验收

V0.21E 让 Workspace 审计日志页面的筛选条件进入地址栏。用户打开带查询参数的审计链接时，页面会恢复对应筛选；修改筛选后，URL 会同步更新，便于刷新、复制和分享同一审计上下文。

## 范围

- 从 URL 初始化 `traceId`、`action`、`targetType`、`outcome`。
- 修改筛选条件时同步更新 URL，不刷新页面。
- 保留 URL 中其他无关查询参数。
- 清空筛选时移除对应查询参数。
- 查询 API 继续使用现有 `GET /api/workspaces/{workspaceId}/audit-events`。

## 验收清单

- [x] 打开 `/settings/audit?traceId=...&action=...` 时，筛选框自动填充。
- [x] 修改“结果”筛选后，地址栏追加或更新 `outcome`。
- [x] 既有 `traceId` 和 `action` 不会被新筛选覆盖。
- [x] 审计 API 请求携带与当前 URL 一致的筛选条件。
- [x] 浏览器验收截图已补充。

## 自动化验证

- `npx vitest run src/pages/AuditLog.test.tsx --reporter verbose --pool=forks --fileParallelism=false --testTimeout 15000`
  - 结果：通过，1 个文件、4 项测试通过。
- `apps\api\.venv\Scripts\python.exe -m pytest apps/api/tests -q -ra`
  - 结果：通过，218 项后端测试通过，保留既有 StarletteDeprecationWarning。
- `npx vitest run --pool=forks --fileParallelism=false --testTimeout 15000 --reporter verbose`
  - 结果：通过，33 个文件、152 项前端测试通过。
- `npm run lint`
  - 结果：通过。
- `npm run build`
  - 结果：通过，保留既有 Vite chunk size warning。

## 浏览器验收

- 起点：`http://127.0.0.1:4173/w/ai-capability-center/settings/audit?traceId=trace-40e6e658-e117-4d8f-8081-5d4c891e6ff5&action=run.batch_rerun`
- 初始结果：Trace ID 和动作筛选自动恢复，页面展示 `run.batch_rerun` 审计事件。
- 操作：将“结果”筛选改为 `success`。
- 结果：URL 更新为 `http://127.0.0.1:4173/w/ai-capability-center/settings/audit?traceId=trace-40e6e658-e117-4d8f-8081-5d4c891e6ff5&action=run.batch_rerun&outcome=success`。
- 页面状态：`Trace ID`、`动作`、`结果` 控件值分别为目标 trace、`run.batch_rerun` 和 `success`，列表保留匹配事件。
- 控制台错误：0。
- 截图：`.scratch/v0.21e-audit-filter-url-sync/browser-acceptance.png`

## 非目标

- 不新增后端接口。
- 不新增审计事件详情页。
- 不新增导出、回滚、跨 Workspace 查询或跨系统 Trace 联邦查询。
