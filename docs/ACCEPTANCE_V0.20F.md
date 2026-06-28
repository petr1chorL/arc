# V0.20F 批量操作结果面板验收

V0.20F 补齐 Runs 页面批量操作的失败可解释性。批量重跑和批量失败点恢复在部分成功、部分失败时，不再只显示失败数量，而是展示每个失败源 Run 的 ID 与失败原因。

## 范围

- 批量重跑返回 `failures` 时展示失败项列表。
- 批量失败点恢复返回 `failures` 时展示失败项列表。
- 每条失败项展示 `sourceRunId` 和 `reason`。
- 下一次刷新或新的运行操作前清空旧失败项，避免残留误导。
- 不改变后端接口、权限、批量成功项处理逻辑和审计写入逻辑。

## 验收标准

- [x] 批量重跑部分失败时，页面展示“未完成的批量项”。
- [x] 批量重跑部分失败时，页面展示失败源 Run ID 与失败原因。
- [x] 批量失败点恢复部分失败时，页面展示“未完成的批量项”。
- [x] 批量失败点恢复部分失败时，页面展示失败源 Run ID 与失败原因。
- [x] 刷新、单条重跑、编辑输入重跑、单条恢复、批量重跑、批量恢复会先清空旧失败项。

## 自动验证

- `npx vitest run src/pages/Runs.test.tsx --reporter verbose --pool=forks --fileParallelism=false --testTimeout 15000`
- `npx vitest run --pool=forks --fileParallelism=false --testTimeout 15000`
- `npm run lint`
- `npm run build`

## 浏览器验收

- 页面：`http://127.0.0.1:4173/w/ai-capability-center/runs`
- Fixture：`V0.20F Browser Partial Resume Valid 46f19d` 与 `V0.20F Browser Partial Resume Invalid 46f19d`
- 操作：搜索 `V0.20F Browser Partial Resume`，勾选两条失败 Workflow Run，点击“批量恢复”。
- 结果：页面展示“已批量恢复 1 条，1 条失败”，并展示“未完成的批量项”、失败 Run ID `1134251d-03a9-42f9-a457-5f8cfa647e9f` 和失败原因 `Run has no resumable failed node`。
- Console error：0。
- 截图：`.scratch/v0.20f-batch-operation-result/browser-acceptance.png`

## 非目标

- 不新增后端接口。
- 不新增异步批量任务。
- 不做失败原因分类或自动修复建议。
- 不改变批量恢复的原地更新策略。
