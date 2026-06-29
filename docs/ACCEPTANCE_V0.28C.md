# V0.28C 修复任务来源反查入口验收记录

## 版本目标

补齐 Remediation Task 的来源反查闭环：用户进入评估中心处理修复任务后，可以从任务卡片直接回到原始 Artifact 和来源运行链路。

## 验收范围

- `clusterKey=artifact:<artifactVersionId>` 的任务卡片展示“查看产出物”链接。
- “查看产出物”链接指向当前 Workspace 的 `/artifacts?artifactVersionId=<artifactVersionId>`。
- 任务卡片展示“查看运行链路”链接。
- “查看运行链路”链接指向当前 Workspace 的 `/observability?runId=<sourceRunId>`。
- 两个链接的可访问名称包含 Remediation Task ID。
- 非 Artifact 聚类任务不展示“查看产出物”入口。
- 现有任务高亮、筛选、评论、状态流转和复测能力不回退。

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
```

## 当前验证结果

- RED 验证：新增链接断言后，聚焦测试失败，失败原因是找不到可访问名称为“查看 remediation-task-1 产出物”的链接。
- GREEN 验证：实现链接后，同一聚焦测试通过，1 个用例通过；同一用例同时覆盖非 Artifact 聚类任务不展示“查看产出物”链接。
- Evaluations + Artifacts 回归通过：30 个用例通过。
- Artifact API 回归通过：2 个用例通过。
- Observability 回归通过：12 个用例通过。
- Layout 回归通过：6 个用例通过。
- 浏览器端到端验收通过，覆盖 Artifact 创建修复任务、跳转评估中心定位任务、验证任务卡片来源链接、进入运行链路和反向查看产出物。
- `npm run lint` 通过。
- `npm run build` 通过；仅保留 Vite chunk size warning，非失败。

## 当前限制

- 不新增单条 Remediation Task 详情页。
- 不新增后端任务详情 API。
- Observability 链接只携带 Run ID，不从 `action` 文本中解析 NodeRun ID。
- 非 Artifact 聚类任务仅保留运行链路入口。
