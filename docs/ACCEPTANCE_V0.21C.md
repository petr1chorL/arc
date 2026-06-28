# V0.21C 审计日志反向跳回运行中心验收

V0.21C 补齐 Audit -> Run 的反向导航。用户在审计日志中看到 `run` 对象事件时，可以点击“查看运行”回到运行中心，并自动选中对应 Run。

## 范围

- 审计日志 run 事件展示“查看运行”链接。
- 链接地址为 `/w/{workspaceSlug}/runs?runId={runId}`。
- 运行中心支持读取 `runId` 查询参数，并在运行列表加载后优先选中该 Run。
- 如果查询参数对应 Run 不存在，仍回退到第一条运行记录。

## 验收清单

- [x] AuditLog 页面 run 审计事件有“查看运行”入口。
- [x] “查看运行”链接携带当前 Workspace slug 和 URL 编码后的 Run ID。
- [x] Runs 页面打开 `?runId=...` 后选中对应 Run。
- [x] 不新增后端 API，不改变审计和运行列表查询语义。

## 自动化验证

- `npx vitest run src/pages/AuditLog.test.tsx --reporter verbose --pool=forks --fileParallelism=false --testTimeout 15000`
  - 结果：通过，3 个测试通过。
- `npx vitest run src/pages/Runs.test.tsx --reporter verbose --pool=forks --fileParallelism=false --testTimeout 15000`
  - 结果：通过，11 个测试通过。

## 浏览器验证

- 起点：`http://127.0.0.1:4173/w/ai-capability-center/settings/audit?traceId=trace-40e6e658-e117-4d8f-8081-5d4c891e6ff5`
- 页面显示：`run.batch_rerun` 审计事件与“查看运行”链接。
- 操作：点击“查看运行”。
- 结果：跳转到 `http://127.0.0.1:4173/w/ai-capability-center/runs?runId=40e6e658-e117-4d8f-8081-5d4c891e6ff5`。
- 页面选中：`V0.21A Browser Operation History 7f3c2a`。
- 控制台错误：0。
- 截图：`.scratch/v0.21c-audit-run-deeplink/browser-acceptance.png`

## 非目标

- 不新增跨 Workspace 跳转。
- 不在审计日志中内嵌 Run 详情。
- 不新增后端查询接口。
