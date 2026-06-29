# V0.29D 验收记录：修复任务详情关闭入口

## 范围

V0.29D 在评估中心 Remediation Task 详情区域增加“关闭详情”入口，让用户可以退出 `taskId` 深链聚焦上下文并回到任务列表。

## 已实现

- 修复任务详情区域展示“关闭详情”按钮。
- 点击后移除当前 URL query 中的 `taskId`。
- 点击后“修复任务详情”区域隐藏。
- Remediation Tasks 列表继续展示。
- 关闭详情不新增后端请求、数据库字段或审计事件。

## 本版不包含

- 不新增独立 Remediation Task 详情路由。
- 不新增后端 API。
- 不新增数据库字段。
- 不新增浏览器历史自定义逻辑。
- 不改变任务状态机、复测、评论或运营字段编辑能力。

## TDD 证据

RED：

```powershell
npm run test -- --run src/pages/Evaluations.test.tsx -t "closes the remediation task detail"
```

结果：失败，原因是修复任务详情区域不存在 accessible name 为“关闭详情”的按钮。

GREEN：

```powershell
npm run test -- --run src/pages/Evaluations.test.tsx -t "closes the remediation task detail"
```

结果：1 个测试通过。

## 最终验证

```powershell
npm run test -- --run src/pages/Evaluations.test.tsx -t "remediation task detail"
```

结果：1 个测试文件通过，4 个测试通过。

```powershell
npm run test -- --run --no-file-parallelism src/pages/Evaluations.test.tsx src/pages/Artifacts.test.tsx src/pages/Observability.test.tsx src/api/artifacts.test.ts src/components/Layout.test.tsx
```

结果：5 个测试文件通过，54 个测试通过。

```powershell
npm run lint
```

结果：通过。

```powershell
npm run build
```

结果：通过；Vite 保留既有 chunk size warning。

```powershell
git diff --check
```

结果：通过；仅显示 Windows 工作区 LF/CRLF 提示。

```powershell
python C:\Users\a\.codex\skills\webapp-testing\scripts\with_server.py --server "npm run preview -- --host 127.0.0.1 --port 4203" --port 4203 --timeout 30 -- python .scratch\v0.29d-remediation-task-detail-close\browser-check.py
```

结果：通过。浏览器进入评估中心 Remediation Task 深链，点击“关闭详情”后，详情区隐藏，Remediation Tasks 列表保留，地址栏路径为 `/w/ai-capability-center/evaluations` 且 query 中不再包含 `taskId`。
