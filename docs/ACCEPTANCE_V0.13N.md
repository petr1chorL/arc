# V0.13N 验收说明：执行队列状态筛选

> 日期：2026-06-27

## 本版完成内容

V0.13N 把后端已有的 `GET /execution-jobs?status=...` 能力接入运行观测页。

- 执行队列运营卡新增“状态”筛选控件。
- 支持按全部队列、排队中、运行中、已完成、死信、已取消筛选。
- 切换筛选后重新请求执行队列 API。
- 非“全部队列”状态会传递 `status` 查询参数。
- 切换筛选时清空旧任务详情，避免展示上一筛选范围里的任务详情。
- 任务数量和任务列表跟随当前筛选结果刷新。

## 没有完成的内容

- 多状态复选筛选。
- 队列任务按时间、尝试次数或 Worker 排序。
- 队列任务分页。
- 队列任务批量重新入队或批量取消。

## 自动化验收

### RED/GREEN 验证

```powershell
npm test -- --run src/pages/Observability.test.tsx
```

RED 结果：

- 首次失败，因为观测页执行队列卡片没有可访问的“队列状态筛选”控件。

GREEN 结果：

- 观测页测试 7 项通过。
- 选择“死信”会请求 `/execution-jobs?status=dead_letter`。
- 页面任务数从 `2 条任务` 更新为 `1 条任务`。
- 死信任务保留，排队中任务从列表消失。

### Focused 回归

```powershell
npm test -- --run src/pages/Observability.test.tsx src/api/execution.test.ts --reporter verbose
```

实际结果：

- 前端观测页与 execution API 2 个测试文件、13 项通过。

### 全量回归

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q
npm test -- --run --reporter verbose
npm run lint
npm run build
git diff --check
```

实际结果：

- 后端完整测试集通过。
- 前端 27 个测试文件、103 项测试通过。
- `npm run lint` 通过。
- `npm run build` 通过，保留 Vite chunk size 既有提示。
- `git diff --check` 仅有 Windows 换行提示，没有 whitespace error。

## 人工验收路径

页面：

```text
http://127.0.0.1:4173/w/ai-capability-center/observability
```

验收步骤：

1. 打开运行观测页。
2. 找到“执行队列运营”卡片。
3. 在右上角“状态”下拉框选择“死信”。
4. 确认列表只显示死信任务，并且任务数同步变化。
5. 切回“全部队列”，确认队列列表恢复为全部任务。

实际结果：

- 页面存在唯一的“队列状态筛选”控件。
- 选择“死信”后控件值为 `dead_letter`。
- 执行队列运营卡显示 `1 条任务`。
- 死信任务可见。
- 排队中任务不可见。
- 浏览器控制台新增 warning/error 为 0。

验收材料：

- `.scratch/v0.13n-execution-queue-status-filter.png`
- `.scratch/v0.13n-browser-result.json`
