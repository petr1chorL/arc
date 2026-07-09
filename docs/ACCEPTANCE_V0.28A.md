# V0.28A Artifact 创建修复任务入口验收记录

## 版本目标

把失败或低分 Artifact 从“可查看、可追溯”推进到“可创建修复任务”，接入现有 Remediation Task 闭环。

## 验收范围

- 失败或低分 Artifact 卡片显示“创建修复任务”按钮。
- 点击按钮会调用现有 Remediation Task 创建 API。
- 创建 payload 包含 ArtifactVersion、Run、NodeRun、来源节点和失败原因。
- Schema 失败任务使用 `P1` 优先级；低分但未 Schema 失败任务使用 `P2`。
- 创建中、创建成功、创建失败都有明确的卡片内反馈。
- 浏览器验收覆盖 Artifact 筛选、卡片运行链路、创建修复任务、详情链路和 Observability 反向回到 Artifact。

## 已验证命令

```powershell
npm run test -- src/pages/Artifacts.test.tsx -t "remediation" --run
npm run test -- src/api/artifacts.test.ts src/pages/Artifacts.test.tsx src/components/Layout.test.tsx --run
npm run test -- src/pages/Observability.test.tsx --run
npm run test -- src/pages/Evaluations.test.tsx --run
npm run lint
npm run build
$env:ARC_ONE_PORT='4201'; apps/api/.venv/Scripts/python.exe C:\Users\a\.codex\skills\webapp-testing\scripts\with_server.py --server "npm run dev -- --host 127.0.0.1 --port 4201" --port 4201 -- node .scratch\v0.26c-artifact-catalog-ui\browser-check.mjs
```

## 验证结果

- 聚焦 remediation 测试通过：1 个用例通过。
- Artifact/API/Layout 回归通过：22 个用例通过。
- Observability 回归通过：12 个用例通过。
- Evaluations 回归通过：15 个用例通过。
- `npm run lint` 通过。
- `npm run build` 通过；仅保留 Vite chunk size warning，非失败。
- 浏览器端到端验收通过，截图输出到 `.scratch/v0.26c-artifact-catalog-ui/browser-artifacts.png`，结果输出到 `.scratch/v0.26c-artifact-catalog-ui/browser-result.json`。

## 当前限制

- 不新增后端接口，复用现有 Remediation Task API。
- 不做批量创建。
- 不新增修复任务详情页跳转。
- 前端成功提示不跨页面刷新持久化；真实任务记录由后端持久化。
