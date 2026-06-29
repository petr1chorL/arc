# V0.29C 验收记录：修复任务详情复制链接

## 范围

V0.29C 在评估中心 Remediation Task 详情区域增加一键复制任务详情链接能力。链接格式为当前浏览器 origin 加当前 Workspace 路径：

```text
/w/:workspaceSlug/evaluations?taskId=<taskId>
```

## 已实现

- “修复任务详情”区域展示“复制任务链接”按钮。
- 点击后调用 `navigator.clipboard.writeText`。
- 复制内容包含当前 origin、当前 Workspace slug 和当前 Remediation Task ID。
- 复制成功后展示“已复制修复任务链接”。
- 复制失败后展示“复制失败，请手动复制地址栏链接”。
- 切换定位任务时清空上一条复制反馈。

## 本版不包含

- 不新增后端 API。
- 不新增数据库字段。
- 不新增短链服务。
- 不新增分享权限模型。
- 不新增审计事件或通知发送。

## TDD 证据

RED：

```powershell
npm run test -- --run src/pages/Evaluations.test.tsx -t "copies the remediation task detail link"
```

结果：失败，原因是修复任务详情区域不存在 accessible name 为“复制任务链接”的按钮。

GREEN：

```powershell
npm run test -- --run src/pages/Evaluations.test.tsx -t "copies the remediation task detail link"
```

结果：1 个测试通过。

失败分支：

```powershell
npm run test -- --run src/pages/Evaluations.test.tsx -t "remediation task detail link"
```

结果：2 个测试通过，覆盖复制成功和剪贴板拒绝写入两种路径。

## 最终验证

```powershell
npm run test -- --run src/pages/Evaluations.test.tsx -t "remediation task detail link"
```

结果：1 个测试文件通过，2 个测试通过。

```powershell
npm run test -- --run --no-file-parallelism src/pages/Evaluations.test.tsx src/pages/Artifacts.test.tsx src/pages/Observability.test.tsx src/api/artifacts.test.ts src/components/Layout.test.tsx
```

结果：5 个测试文件通过，53 个测试通过。

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
python C:\Users\a\.codex\skills\webapp-testing\scripts\with_server.py --server "npm run preview -- --host 127.0.0.1 --port 4202" --port 4202 --timeout 30 -- python .scratch\v0.29c-remediation-task-share-link\browser-check.py
```

结果：通过。浏览器进入 `/w/ai-capability-center/evaluations?taskId=remediation-task-1`，点击“复制任务链接”，页面展示“已复制修复任务链接”，并验证剪贴板写入 URL 为当前 origin + `/w/ai-capability-center/evaluations?taskId=remediation-task-1`。
