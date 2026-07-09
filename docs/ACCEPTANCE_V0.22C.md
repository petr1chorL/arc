# V0.22C 人工审核 URL 上下文提示验收

V0.22C 在人工审核页补充“当前审核上下文”提示，让从 SLA 风险、运行观测或分享链接进入的用户能看懂当前视图来源、任务和筛选条件。

## 范围

- 读取 `source` 查询参数并展示可读来源。
- 在存在来源或非默认筛选时展示“当前审核上下文”。
- 展示当前任务 ID、任务状态筛选和 SLA 筛选。
- 提供“清空上下文筛选”按钮，将任务状态和 SLA 恢复为 `全部`。
- 清空筛选时保留 `taskId`、`source` 和其他无关查询参数。

## 验收清单

- [x] 打开带 `source=sla` 的人工审核深链时，页面展示“当前审核上下文”。
- [x] 上下文提示展示 `来自 SLA 风险入口`、当前任务、状态和 SLA。
- [x] 点击“清空上下文筛选”后，URL 删除 `taskStatus` 与 `slaStatus`。
- [x] 清空筛选后，`taskId` 与 `source` 保留。
- [x] 任务状态筛选和 SLA 筛选控件恢复为 `全部`。
- [x] 不改变认领、转交、通过、驳回或权限判断逻辑。

## 自动化验证

- `npx vitest run src/pages/Reviews.test.tsx --reporter verbose --pool=forks --fileParallelism=false --testTimeout 15000`
  - 结果：通过，1 个文件、15 项测试通过。
- `apps\api\.venv\Scripts\python.exe -m pytest apps/api/tests -q -ra`
  - 结果：通过，后端测试退出码 0，保留既有 StarletteDeprecationWarning。
- `npx vitest run --pool=forks --fileParallelism=false --testTimeout 15000 --reporter verbose`
  - 结果：通过，33 个文件、155 项前端测试通过。
- `npm run lint`
  - 结果：通过。
- `npm run build`
  - 结果：通过，保留既有 Vite chunk size warning。

## 浏览器验收

- 起点：`http://127.0.0.1:4173/w/ai-capability-center/reviews?taskId=task-1&source=sla&taskStatus=待认领&slaStatus=即将到期`
- 初始结果：页面展示“当前审核上下文”，来源为 `来自 SLA 风险入口`，并展示当前任务、`状态 待认领` 和 `SLA 即将到期`。
- 操作：点击上下文提示中的“清空上下文筛选”。
- 结果：URL 删除 `taskStatus` 和 `slaStatus`，保留 `source=sla` 与当前 `taskId`；任务状态筛选和 SLA 筛选都恢复为 `全部`。
- 控制台错误：0。
- 截图：`.scratch/v0.22c-review-url-context/browser-acceptance.png`

## 非目标

- 不新增后端接口。
- 不新增返回来源页面按钮。
- 不改变 URL 参数命名。
- 不改变 Reviewer 资格、参与范围、认领、转交或审核决定规则。
