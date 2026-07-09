# V0.22B 人工审核筛选同步 URL 验收

V0.22B 让人工审核页的任务状态筛选和 SLA 筛选进入地址栏。它与 V0.22A 的 `taskId` 同步一起形成可复制、可刷新恢复的审核队列视图。

## 范围

- 从 `taskStatus` 初始化任务状态筛选。
- 从 `slaStatus` 初始化 SLA 筛选。
- 修改筛选条件时同步 URL。
- 筛选值为 `全部` 时移除对应查询参数。
- 保留 `taskId` 和其他无关查询参数。

## 验收清单

- [x] 打开 `/reviews?taskStatus=...&slaStatus=...` 时，筛选控件恢复对应值。
- [x] 修改 SLA 筛选为 `全部` 后，URL 移除 `slaStatus`。
- [x] 修改任务状态筛选后，URL 更新 `taskStatus`。
- [x] `taskId` 和来源参数不会丢失。
- [x] 浏览器验收截图已补充。

## 自动化验证

- `npx vitest run src/pages/Reviews.test.tsx --reporter verbose --pool=forks --fileParallelism=false --testTimeout 15000`
  - 结果：通过，1 个文件、14 项测试通过。
- `apps\api\.venv\Scripts\python.exe -m pytest apps/api/tests -q -ra`
  - 结果：通过，218 项后端测试通过，保留既有 StarletteDeprecationWarning。
- `npx vitest run --pool=forks --fileParallelism=false --testTimeout 15000 --reporter verbose`
  - 结果：通过，33 个文件、154 项前端测试通过。
- `npm run lint`
  - 结果：通过。
- `npm run build`
  - 结果：通过，保留既有 Vite chunk size warning。

## 浏览器验收

- 起点：`http://127.0.0.1:4173/w/ai-capability-center/reviews?source=sla&taskStatus=待认领&slaStatus=已升级`
- 初始结果：任务状态筛选恢复为 `待认领`，SLA 筛选恢复为 `已升级`。
- 操作 1：将 SLA 筛选改为 `全部`。
- 结果 1：URL 删除 `slaStatus`，保留 `source=sla`、`taskStatus=待认领` 和当前 `taskId`。
- 操作 2：将任务状态筛选改为 `全部`。
- 结果 2：URL 删除 `taskStatus`，保留 `source=sla` 和当前 `taskId`，队列恢复显示 10 条任务。
- 控制台错误：0。
- 截图：`.scratch/v0.22b-review-filter-url-sync/browser-acceptance.png`

## 非目标

- 不新增后端接口。
- 不新增服务端分页或复杂搜索。
- 不改变 Reviewer 资格、参与范围、认领、转交或审核决定规则。
