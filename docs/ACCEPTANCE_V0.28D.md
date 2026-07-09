# V0.28D 修复任务详情视图验收记录

## 版本目标

让 `taskId` 深链不只是高亮 Remediation Task 卡片，而是展示一个围绕当前任务组织的详情视图，方便处理人聚焦查看来源、状态、建议动作和处理时间线。

## 验收范围

- 访问 `/evaluations?taskId=<id>` 且任务存在时，页面展示 aria-label 为 `修复任务详情 <id>` 的详情区域。
- 详情区域展示任务标题、优先级、状态、负责人、截止时间、来源 Run、聚类 Key、样本数量和建议动作。
- Artifact 来源任务的详情区域展示“查看产出物”和“查看运行链路”链接。
- 非 Artifact 来源任务的卡片不展示“查看产出物”，但仍展示“查看运行链路”。
- 每张任务卡片展示“打开详情”链接，指向当前 Workspace 的 `/evaluations?taskId=<id>`。
- 现有任务高亮、来源反查、评论、状态流转和复测能力不回退。

## 已验证命令

```powershell
npm run test -- src/pages/Evaluations.test.tsx -t "remediation task deep link" --run
npm run test -- src/pages/Evaluations.test.tsx src/pages/Artifacts.test.tsx --run
npm run test -- src/api/artifacts.test.ts --run
npm run test -- src/pages/Observability.test.tsx --run
npm run test -- src/components/Layout.test.tsx --run
$env:ARC_ONE_PORT='4201'; apps/api/.venv/Scripts/python.exe C:\Users\a\.codex\skills\webapp-testing\scripts\with_server.py --server "npm run dev -- --host 127.0.0.1 --port 4201" --port 4201 -- node .scratch\v0.26c-artifact-catalog-ui\browser-check.mjs
npm run lint
npm run build
git diff --check
```

## 当前验证结果

- RED 验证：新增详情断言后，聚焦测试失败，失败原因是找不到 aria-label 为 `修复任务详情 remediation-task-1` 的区域。
- GREEN 验证：实现详情视图后，同一聚焦测试通过，1 个用例通过。
- Evaluations + Artifacts 回归通过：30 个用例通过。
- Artifact API 回归通过：2 个用例通过。
- Observability 回归通过：12 个用例通过。
- Layout 回归通过：6 个用例通过。
- 浏览器端到端验收通过，覆盖 Artifact 创建修复任务、进入评估中心、展示修复任务详情、检查来源链接、进入运行链路和反向查看产出物。
- `npm run lint` 通过。
- `npm run build` 通过；仅保留 Vite chunk size warning，非失败。
- `git diff --check` 通过；仅输出 Windows 换行提示，非空白错误。

## 当前限制

- 不新增独立 Remediation Task 详情页路由。
- 不新增后端单任务读取 API。
- 评论表单、状态按钮和复测按钮仍保留在任务卡片内。
- 当前详情视图依赖列表接口返回该任务；筛选条件导致任务不在列表时仍显示“未找到定位任务”。
