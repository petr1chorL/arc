# V0.13O 验收说明：队列运营动作原因记录

> 日期：2026-06-28

## 本版完成内容

V0.13O 把后端已有的队列运营审计原因能力接到前端。

- `requeueExecutionJob` 支持传入操作原因，并以 JSON body 提交。
- `cancelExecutionJob` 支持传入操作原因，并以 JSON body 提交。
- 运行观测页点击“重新入队”或“取消任务”后，不再直接提交。
- 页面会先展开“记录队列操作原因”面板。
- 操作原因必填；空提交会提示“请填写操作原因”。
- 填写原因后才会调用对应队列运营接口。
- 提交成功后关闭原因面板并刷新队列列表。

## 没有完成的内容

- 原因模板 / 快捷短语。
- 二次确认弹窗。
- 运营动作历史在队列卡片内直接展开。
- 批量重新入队 / 批量取消时的统一原因。

## 自动化验收

### RED/GREEN 验证

```powershell
npm test -- --run src/api/execution.test.ts --reporter verbose
npm test -- --run src/pages/Observability.test.tsx -t "records a queue operation reason" --reporter verbose
```

RED 结果：

- API wrapper 首次失败，因为 requeue/cancel 请求没有 JSON body。
- 页面测试首次失败，因为点击“重新入队”后没有“记录队列操作原因”面板。

GREEN 结果：

- `requeueExecutionJob(workspaceId, jobId, reason)` 会提交 `{ reason }`。
- `cancelExecutionJob(workspaceId, jobId, reason)` 会提交 `{ reason }`。
- 页面空原因提交会显示“请填写操作原因”。
- 填写原因后调用 `/execution-jobs/{jobId}/requeue`。

### Focused 回归

```powershell
npm test -- --run src/pages/Observability.test.tsx --reporter verbose
npm test -- --run src/api/execution.test.ts --reporter verbose
```

实际结果：

- 观测页 1 个测试文件、8 项通过。
- execution API 1 个测试文件、6 项通过。

### 全量回归

```powershell
npm test -- --run --reporter verbose
npm run lint
npm run build
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q
git diff --check
```

实际结果：

- 前端 27 个测试文件、104 项测试通过。
- `npm run lint` 通过。
- `npm run build` 通过，保留 Vite chunk size 既有提示。
- 后端完整测试集通过。
- `git diff --check` 仅有 Windows 换行提示，没有 whitespace error。

## 浏览器验收

页面：

```text
http://127.0.0.1:4173/w/ai-capability-center/observability
```

实际结果：

- 死信筛选下存在 1 个“重新入队”按钮。
- 点击“重新入队”后展示“记录队列操作原因”面板。
- 空原因提交展示“请填写操作原因”。
- 填写 `V0.13O browser requeue reason` 后提交成功。
- 死信筛选下任务数变为 `0 条任务`。
- 浏览器控制台新增 warning/error 为 0。

验收材料：

- `.scratch/v0.13o-queue-action-reason.png`
- `.scratch/v0.13o-browser-result.json`

