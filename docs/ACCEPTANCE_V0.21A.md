# V0.21A Run 操作历史验收

V0.21A 在运行中心补齐 Run 维度的操作历史。用户选中一条 Run 后，可以直接看到与该 Run 相关的重跑、批量重跑、失败点恢复和批量恢复审计事件。

## 范围

- 新增 Run 操作历史只读接口。
- 操作历史复用 Workspace 审计事件作为事实来源。
- Runs 页面展示操作历史动作、结果、原因、requestId 和关键 metadata。
- 操作历史加载失败时不影响 Run 主详情。

## 验收标准

- [x] 接口返回当前 Workspace 内与目标 Run 相关的运行操作审计事件。
- [x] 接口按创建时间倒序返回事件。
- [x] 页面展示“操作历史”区块。
- [x] 页面展示动作中文名，例如“批量重跑”“批量恢复”。
- [x] 页面展示 `requestId` 与 `sourceRunId`、`newRunId`、`runId`、`failedNodeId` 等关键 metadata。
- [x] 页面在历史为空时展示空态。
- [x] 页面在历史加载失败时展示错误态，且不阻断 Run 主详情。

## 自动验证

- `apps\api\.venv\Scripts\python.exe -m pytest apps/api/tests/test_execution_api.py -q -k operation_history`
- `npx vitest run src/api/execution.test.ts src/pages/Runs.test.tsx --reporter verbose --pool=forks --fileParallelism=false --testTimeout 15000`
- `npx vitest run --pool=forks --fileParallelism=false --testTimeout 15000`
- `npm run lint`
- `npm run build`

## 浏览器验收

- 页面：`http://127.0.0.1:4173/w/ai-capability-center/runs`
- Fixture：`V0.21A Browser Operation History 7f3c2a`
- Run ID：`40e6e658-e117-4d8f-8081-5d4c891e6ff5`
- 操作：打开运行中心，选中该 Run。
- 结果：详情页展示“操作历史 1 条”“批量重跑”“req-v021a-browser”“sourceRunId”“newRunId”“workflowVersion: v0.21a-browser”“batchSize: 1”。
- Console error：0。
- 截图：`.scratch/v0.21a-run-operation-history/browser-acceptance.png`

## 非目标

- 不新增审计详情页。
- 不实现运行操作撤销或回滚。
- 不新增跨 Workspace 操作历史查询。
- 不改变 V0.20 系列重跑和恢复接口的执行语义。
