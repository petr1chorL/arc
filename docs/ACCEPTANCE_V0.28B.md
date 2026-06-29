# V0.28B 修复任务深链定位验收记录

## 版本目标

补齐 Artifact 创建修复任务后的继续处理路径：用户可以从 Artifact 成功提示进入评估中心，并直接定位对应 Remediation Task。

## 验收范围

- 访问 `/evaluations?taskId=<id>` 后，Remediation Tasks 区域显示定位提示。
- 定位任务存在时，对应任务卡片进入高亮状态。
- Artifact 创建修复任务成功后显示“查看修复任务”链接。
- 链接指向当前 Workspace 的 `/evaluations?taskId=<id>`。
- Remediation Tasks 看板可独立于 Regression Run Trend 显示。
- 现有任务创建、筛选、评论、状态流转和复测能力不回退。

## 已验证命令

```powershell
npm run test -- src/pages/Evaluations.test.tsx -t "remediation task deep link" --run
npm run test -- src/pages/Artifacts.test.tsx -t "remediation" --run
npm run test -- src/pages/Evaluations.test.tsx src/pages/Artifacts.test.tsx --run
npm run test -- src/api/artifacts.test.ts --run
npm run test -- src/components/Layout.test.tsx --run
npm run test -- src/pages/Observability.test.tsx --run
npm run lint
npm run build
$env:ARC_ONE_PORT='4201'; apps/api/.venv/Scripts/python.exe C:\Users\a\.codex\skills\webapp-testing\scripts\with_server.py --server "npm run dev -- --host 127.0.0.1 --port 4201" --port 4201 -- node .scratch\v0.26c-artifact-catalog-ui\browser-check.mjs
```

## 验证结果

- Evaluations 深链聚焦测试通过：1 个用例通过。
- Artifact remediation 聚焦测试通过：1 个用例通过。
- Evaluations + Artifacts 回归通过：30 个用例通过。
- Artifact API 回归通过：2 个用例通过。
- Layout 回归通过：6 个用例通过。
- Observability 回归最终通过：12 个用例通过。期间出现过一次 Vitest 进程超时；逐用例复跑均通过，随后整文件复跑通过。
- `npm run lint` 通过。
- `npm run build` 通过；仅保留 Vite chunk size warning，非失败。
- 浏览器端到端验收通过，覆盖 Artifact 创建修复任务、跳转评估中心定位任务、回到 Artifact、进入运行链路和反向查看产出物。

## 当前限制

- 不新增单条 Remediation Task 详情页。
- 不新增单条任务读取 API。
- `taskId` 只用于前端定位，不参与 owner / priority / overdue 筛选条件。
