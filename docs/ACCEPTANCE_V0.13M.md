# V0.13M 验收说明：队列任务详情面板

> 日期：2026-06-27

## 本版完成内容

V0.13M 把 V0.13L 的队列任务详情 API 接入运行观测页。

- 执行队列任务卡新增“查看详情”入口。
- 点击后调用 `GET /execution-jobs/{jobId}`。
- 页面展示 Job ID、Run ID、Workflow、尝试次数、Worker 锁、租约、下次尝试和终态时间。
- 页面展示失败原因。
- 页面展示关联审计事件，包括 action、outcome、before/after status、reason、操作者和时间。
- 详情加载中、加载失败和无审计事件均有可见状态。

## 没有完成的内容

- 独立队列运营详情页。
- 队列任务详情中的 NodeRun / Run 时间线聚合。
- 队列任务排障建议。
- 批量队列运营。

## 自动化验收

### RED/GREEN 验证

```powershell
npm test -- --run src/pages/Observability.test.tsx
```

RED 结果：

- 首次失败，因为观测页执行队列卡片没有“查看详情”按钮。

GREEN 结果：

- 观测页测试 6 项通过。
- 点击“查看详情”会请求 `/execution-jobs/job-dead-letter`。
- 页面展示“队列任务详情”、审计原因“详情页验证重投审计”和状态流转 `dead_letter → queued`。

### Focused 回归

```powershell
npm test -- --run src/pages/Observability.test.tsx
```

实际结果：

- 前端观测页与 execution API 2 个测试文件、12 项通过。

### 全量回归

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q
npm test -- --run
npm run lint
npm run build
git diff --check
```

实际结果：

- 后端 184 项测试通过。
- 前端 27 个测试文件、102 项测试通过。
- `npm run lint` 通过。
- `npm run build` 通过，保留 Vite chunk size 既有提示。
- `git diff --check` 仅有 Windows 换行提示，没有 whitespace error。

## 浏览器验收

页面：

```text
http://127.0.0.1:4173/w/ai-capability-center/observability
```

实际结果：

- 当前 Workspace 有 1 个可见“查看详情”按钮。
- 点击后展示“队列任务详情”。
- 详情面板展示 Job ID `833951a1-1ca4-42e8-85f0-fa98178e84b5`。
- 详情面板展示失败原因 `V0.13M browser dead letter check`。
- 详情面板展示审计原因 `V0.13M browser audit reason`。
- 详情面板展示状态流转 `dead_letter → queued`。
- 浏览器控制台新增 warning/error 为 0。

验收材料：

- `.scratch/v0.13m-execution-job-detail-panel.png`
- `.scratch/v0.13m-browser-result.json`
