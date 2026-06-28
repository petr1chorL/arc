# V0.22A 人工审核任务选择同步 URL 验收

V0.22A 让人工审核页当前选中的 Human Task 进入地址栏。用户从深链进入、手动切换任务、刷新页面或复制链接时，都能稳定复现同一个审核任务上下文。

## 范围

- 保留 `/reviews?taskId=...` 初始选中能力。
- 点击审核队列任务后同步更新 `taskId`。
- 保留其他无关查询参数。
- 没有选中任务时移除 `taskId`。
- 不改变 Human Task 后端接口和审核动作契约。

## 验收清单

- [x] 打开 `/reviews?taskId=...` 时仍选中对应任务。
- [x] 点击审核队列另一个任务后，URL 更新为该任务 ID。
- [x] URL 中已有其他查询参数不会丢失。
- [x] 任务详情随选中任务切换。
- [x] 浏览器验收截图已补充。

## 自动化验证

- `npx vitest run src/pages/Reviews.test.tsx --reporter verbose --pool=forks --fileParallelism=false --testTimeout 15000`
  - 结果：通过，1 个文件、13 项测试通过。
- `apps\api\.venv\Scripts\python.exe -m pytest apps/api/tests -q -ra`
  - 结果：通过，218 项后端测试通过，保留既有 StarletteDeprecationWarning。
- `npx vitest run --pool=forks --fileParallelism=false --testTimeout 15000 --reporter verbose`
  - 结果：通过，33 个文件、153 项前端测试通过。
- `npm run lint`
  - 结果：通过。
- `npm run build`
  - 结果：通过，保留既有 Vite chunk size warning。

## 浏览器验收

- 起点：`http://127.0.0.1:4173/w/ai-capability-center/reviews?pane=queue`
- 初始结果：页面自动选中首个审核任务，并把当前 URL 补为 `?pane=queue&taskId=...`。
- 操作：点击审核队列第二条任务。
- 结果：URL 更新为 `http://127.0.0.1:4173/w/ai-capability-center/reviews?pane=queue&taskId=a9e010e7-0c88-41b3-9f98-9f0c74f3a2ff`。
- 页面状态：队列选中项和详情区 `.mono` 均显示 `a9e010e7-0c88-41b3-9f98-9f0c74f3a2ff`。
- 控制台错误：0。
- 截图：`.scratch/v0.22a-review-task-url-sync/browser-acceptance.png`

## 非目标

- 不新增后端接口。
- 不新增复制链接按钮。
- 不改变 Reviewer 资格、参与范围、认领、转交或审核决定规则。
