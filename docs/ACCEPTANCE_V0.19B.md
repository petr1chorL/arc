# V0.19B 运行记录与审计联动验收

## 范围

V0.19B 在 V0.19A Trace 链路索引和 V0.18A Workspace 审计日志中心之上，补充运行观测到审计日志的 Trace 深链。

## 已实现

- `GET /api/workspaces/{workspaceId}/audit-events` 新增 `traceId` 查询参数。
- 审计日志页面新增 Trace ID 筛选框，并读取 URL 中的 `?traceId=` 初始值。
- 审计日志页面在 Trace ID 生效时展示“当前 Trace 过滤”上下文。
- 运行观测详情页 Trace ID 区块新增“查看审计日志”链接，跳转到当前 Workspace 的审计日志并携带当前运行 Trace ID。
- `traceId` 可与动作、对象类型、结果和 limit 组合过滤。

## 验收标准

- [x] 后端只返回当前 Workspace 内匹配 `traceId` 的审计事件。
- [x] 审计日志页面打开 `/settings/audit?traceId=...` 后自动填充 Trace ID 并参与请求。
- [x] 运行观测详情页提供“查看审计日志”入口，链接携带当前运行 `traceId`。
- [x] 现有动作、对象类型、结果过滤继续可组合使用。
- [x] Viewer 仍不能读取 Workspace 审计日志。
- [x] 页面不展示密钥、Token、cookie、secret、password 或环境变量 metadata。

## 验证证据

- RED 后端测试首次失败：`traceId` 被忽略时返回 2 条审计事件。
- RED 前端测试首次失败：运行观测页缺少“查看审计日志”链接，审计页缺少 Trace ID 过滤。
- Focused 后端：`apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_workspace_access_api.py -q -k "audit_events"`，3 项通过。
- Focused 前端：`npx vitest run src/api/audit.test.ts src/pages/AuditLog.test.tsx src/pages/Observability.test.tsx --reporter verbose --pool=forks --fileParallelism=false --testTimeout 15000`，3 个文件 13 项通过。
- 后端全量：`apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q`，210 项通过，仅保留既有 Starlette deprecation warning。
- 前端全量：`npm run test -- --run --pool=forks --fileParallelism=false --testTimeout 15000`，33 个文件 133 项通过，保留既有 `--localstorage-file` warning。
- `npm run lint` 通过。
- `npm run build` 通过，保留既有 Vite chunk-size warning。
- 浏览器验收：运行观测详情页出现“查看审计日志”，链接为 `/w/ai-capability-center/settings/audit?traceId=trace-4ac6b457-d0bd-4cf5-abd3-4d9cd5eb8854`；点击后审计页 URL、Trace ID 输入框和“当前 Trace 过滤”一致，控制台 warning/error 为 0。
- 截图：`.scratch/v0.19b-audit-trace-filter.png`。

## 未实现

- 不提供审计事件详情页。
- 不提供一键回滚或修复。
- 不新增跨 Workspace / 跨系统 Trace 查询。
