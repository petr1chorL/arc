# V0.28E 修复任务详情处理动作验收记录

## 版本目标

让 Remediation Task 详情区从只读查看升级为可处理的主工作台，处理人不需要回到任务卡片就能提交评论、补附件、推进状态和发起复测。

## 验收范围

- 详情区展示“标记处理中”和“标记完成”按钮，并复用现有状态流转 API。
- 当任务状态为 `done` 且尚无复测 Run 时，详情区展示“发起复测”按钮，并复用现有复测 API。
- 详情区展示 `详情评论内容` 与 `详情附件引用` 输入。
- 从详情区提交评论后，详情时间线和任务卡片时间线都展示新评论与附件。
- 从详情区状态流转或复测后，详情区和任务卡片状态保持一致。
- 任务卡片上的原评论、状态和复测入口继续保留。

## 已验证命令

```powershell
npm run test -- src/pages/Evaluations.test.tsx -t "shows failed sample clusters for the latest Regression Run" --run
npm run test -- src/pages/Evaluations.test.tsx src/pages/Artifacts.test.tsx --run
npm run test -- src/api/artifacts.test.ts --run
npm run test -- src/components/Layout.test.tsx --run
$env:ARC_ONE_PORT='4201'; apps/api/.venv/Scripts/python.exe C:\Users\a\.codex\skills\webapp-testing\scripts\with_server.py --server "npm run dev -- --host 127.0.0.1 --port 4201" --port 4201 -- node .scratch\v0.26c-artifact-catalog-ui\browser-check.mjs
npm run lint
npm run build
git diff --check
```

## 当前验证结果

- RED 验证：详情处理动作测试首次失败，失败原因是详情区找不到 `详情评论内容`。
- GREEN 验证：补充详情区评论、附件、状态按钮和复测入口后，同一聚焦测试通过，1 个用例通过。
- Evaluations + Artifacts 回归通过：30 个用例通过。
- Artifact API 回归通过：2 个用例通过。
- Layout 回归通过：6 个用例通过。
- 浏览器端到端验收通过，覆盖 Artifact 创建修复任务、进入评估中心、展示修复任务详情、检查详情评论/附件输入、检查详情状态按钮、检查来源链接、进入运行链路和反向查看产出物。
- `npm run lint` 通过。
- `npm run build` 通过；仅保留 Vite chunk size warning，非失败。
- `git diff --check` 通过；仅输出 Windows 换行提示，非空白错误。
- `src/pages/Observability.test.tsx` 单独运行两次均在 180 秒左右超时，未作为通过证据；本版未修改 Observability 代码，浏览器验收已覆盖从修复任务详情进入运行链路的关键路径。

## 当前限制

- 不新增独立 Remediation Task 详情页路由。
- 不新增后端单任务读取 API。
- 详情区仍依赖 Remediation Tasks 列表接口返回当前任务。
- 本版不新增批量处理、任务转派或单独的任务活动筛选。
