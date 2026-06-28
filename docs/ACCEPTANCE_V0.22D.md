# V0.22D 人工审核上下文复制链接验收

V0.22D 在“当前审核上下文”提示中增加复制当前链接能力，让人工审核任务、来源和筛选条件可以一键分享给协作者。

## 范围

- 在 URL 上下文提示中展示“复制当前链接”按钮。
- 点击后复制当前人工审核视图的完整链接。
- 复制链接会保留当前 `taskId`、`source`、任务状态筛选、SLA 筛选和其他无关参数。
- 复制成功后展示“已复制当前审核链接”。
- 复制失败后展示“复制失败，请手动复制地址栏链接”。

## 验收清单

- [x] 带 URL 上下文进入人工审核页时可以看到“复制当前链接”。
- [x] 点击复制按钮后写入当前完整人工审核链接。
- [x] 复制链接包含当前任务、来源、任务状态和 SLA 筛选。
- [x] 复制成功提示可见。
- [x] 剪贴板失败时展示可理解的错误提示。
- [x] 不新增后端接口，不改变人工审核动作或权限规则。

## 自动化验证

- `npx vitest run src/pages/Reviews.test.tsx --reporter verbose --pool=forks --fileParallelism=false --testTimeout 15000`
  - 结果：通过，1 个文件、17 项测试通过。
- `apps\api\.venv\Scripts\python.exe -m pytest apps/api/tests -q -ra`
  - 结果：通过，后端测试退出码 0，保留既有 StarletteDeprecationWarning。
- `npx vitest run --pool=forks --fileParallelism=false --testTimeout 15000 --reporter verbose`
  - 结果：通过，33 个文件、157 项前端测试通过。
- `npm run lint`
  - 结果：通过。
- `npm run build`
  - 结果：通过，保留既有 Vite chunk size warning。

## 浏览器验收

- 起点：`http://127.0.0.1:4173/w/ai-capability-center/reviews?source=sla&taskStatus=待认领&slaStatus=即将到期`
- 初始结果：页面展示“当前审核上下文”，包含来源、当前任务、状态、SLA 和“复制当前链接”按钮。
- 操作：点击“复制当前链接”。
- 结果：当前自动化浏览器环境拒绝剪贴板写入，页面展示“复制失败，请手动复制地址栏链接”；失败兜底符合验收标准。成功写入路径由自动化测试中的 mock clipboard 覆盖。
- 控制台错误：0。
- 截图：`.scratch/v0.22d-review-share-link/browser-acceptance.png`

## 非目标

- 不新增短链服务。
- 不新增分享权限模型。
- 不把复制操作写入审计事件。
- 不改变 URL 参数命名或同步规则。
