# V0.21D 运行中心选择同步 URL 验收

V0.21D 让运行中心当前选中的 Run 同步到地址栏 `runId` 查询参数。用户手动切换运行记录后，可以直接复制当前 URL 复现同一条 Run 上下文。

## 范围

- 点击运行中心列表中的 Run 时，同步更新 `runId` 查询参数。
- 保留当前路径和其他查询参数。
- 更新 URL 时不触发页面刷新。
- 重跑、批量重跑、失败点恢复、批量恢复成功后自动选中新 Run/恢复 Run 时，也同步 `runId`。

## 验收清单

- [x] 点击运行列表项后，URL 包含被点击 Run 的 ID。
- [x] 其他查询参数会保留。
- [x] 运行详情区显示被点击 Run。
- [x] V0.21C 的 `?runId=...` 初始选中能力不回归。

## 自动化验证

- `npx vitest run src/pages/Runs.test.tsx --reporter verbose --pool=forks --fileParallelism=false --testTimeout 15000`
  - 结果：通过，12 个测试通过。

## 浏览器验证

- 起点：`http://127.0.0.1:4173/w/ai-capability-center/runs?tab=history`
- 操作：点击第二条运行记录 `V0.20F Browser Partial Resume Invalid 46f19d`。
- 结果：URL 更新为 `http://127.0.0.1:4173/w/ai-capability-center/runs?tab=history&runId=1134251d-03a9-42f9-a457-5f8cfa647e9f`。
- 页面选中：`V0.20F Browser Partial Resume Invalid 46f19d`。
- 控制台错误：0。
- 截图：`.scratch/v0.21d-run-selection-url-sync/browser-acceptance.png`

## 回归验证

- `apps\api\.venv\Scripts\python.exe -m pytest apps/api/tests -q`
  - 结果：通过。
- `npx vitest run @page-files --pool=forks --fileParallelism=false --testTimeout 15000 --reporter verbose`
  - 结果：页面测试通过，13 个文件、84 个测试通过。
- `npx vitest run @non-page-files --pool=forks --fileParallelism=false --testTimeout 15000 --reporter verbose`
  - 结果：非页面测试通过，20 个文件、67 个测试通过。
- `npm run lint`
  - 结果：通过。
- `npm run build`
  - 结果：通过，保留既有 Vite chunk size warning。

说明：单条 `npx vitest run --pool=forks --fileParallelism=false --testTimeout 15000` 在本机两次超时无输出；已按页面/非页面文件全集拆分执行并覆盖同一批前端测试文件。

## 非目标

- 不新增复制链接按钮。
- 不新增后端接口。
- 不改变运行列表排序、筛选和分页语义。
