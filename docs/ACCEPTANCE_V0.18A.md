# V0.18A Workspace 审计日志中心验收

## 范围

V0.18A 将侧边栏已有的「审计日志」入口从占位页升级为 Workspace 级审计日志中心：

- 后端新增 `GET /api/workspaces/{workspaceId}/audit-events`。
- 接口使用 `audit.read` 权限控制，viewer 读取返回 403。
- 接口支持 `action`、`targetType`、`outcome` 和 `limit` 查询参数。
- 前端新增 `src/api/audit.ts` 和 `src/pages/AuditLog.tsx`。
- `/w/:workspaceSlug/settings/audit` 渲染真实审计日志页面，不再显示占位。
- 页面展示动作、对象、结果、操作者、时间、请求/Trace 标识和脱敏 metadata 摘要。
- 页面过滤条支持按动作、对象类型和结果筛选。

## 验收证据

- RED 后端：`apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_workspace_access_api.py -q -k "workspace_audit_events"` 首次失败，两个新场景均因 `/audit-events` 返回 404。
- GREEN 后端聚焦：`apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_workspace_access_api.py -q -k "workspace_audit_events"` 通过，2 项测试。
- 后端 workspace 回归：`apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_workspace_access_api.py -q` 通过，16 项测试。
- RED 前端：`npx vitest run src/api/audit.test.ts src/pages/AuditLog.test.tsx --reporter verbose` 首次失败，原因是 `src/pages/AuditLog.tsx` 尚不存在。
- GREEN 前端聚焦：`npx vitest run src/api/audit.test.ts src/pages/AuditLog.test.tsx --reporter verbose` 通过，2 个文件、2 项测试。
- 全量前端：`npm run test -- --run` 通过，33 个文件、130 项测试。
- 后端全量：`apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q` 通过。
- `npm run lint` 通过。
- `npm run build` 通过，保留既有 Vite chunk-size warning。

## 浏览器验收

- 路由：`http://127.0.0.1:4173/w/ai-capability-center/settings/audit`。
- 已重启 8000 API 进程，确保浏览器使用当前代码。
- 页面显示 `Workspace 审计事件`，不显示「将在后续任务中补齐」。
- 默认加载 Workspace 审计事件列表。
- `结果` 过滤切换为 `denied` 后列表更新为空；再切换为 `success` 后显示 50 条成功事件。
- 页面文本不包含 `apiKey` 或 `API Key`。
- 浏览器控制台 warning/error 数量为 0。

## 非范围

- 不提供审计事件导出。
- 不提供审计事件详情页。
- 不提供审计事件删除、修改、撤销或一键回滚。
