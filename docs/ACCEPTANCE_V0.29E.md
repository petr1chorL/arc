# V0.29E 验收记录：修复任务无效深链恢复

## 范围

V0.29E 在评估中心 Remediation Tasks 看板中，为无法加载的 `taskId` 深链提供“清除定位”入口，让用户能从失效任务链接回到正常任务列表。

## 已实现

- 当 `taskId` 无法加载时，无效定位提示展示“清除定位”按钮。
- 点击后移除当前 URL query 中的 `taskId`。
- 点击后无效定位提示消失。
- Remediation Tasks 列表继续展示当前可见任务。
- 只清除 `taskId`，不主动清空其他筛选上下文。

## 本版不包含

- 不新增后端 API。
- 不新增数据库字段。
- 不新增审计事件。
- 不新增权限模型或分享权限。
- 不改变单条任务 404 / 跨 Workspace / 无权限的后端语义。

## TDD 证据

RED：

```powershell
npm run test -- --run src/pages/Evaluations.test.tsx -t "clears an invalid remediation task deep link"
```

结果：失败，原因是无效定位提示区不存在 accessible name 为“清除定位”的按钮。

GREEN：

```powershell
npm run test -- --run src/pages/Evaluations.test.tsx -t "clears an invalid remediation task deep link"
```

结果：1 个测试通过。

## 最终验证

```powershell
npm run test -- --run src/pages/Evaluations.test.tsx -t "remediation task"
```

结果：1 个测试文件通过，6 个 Remediation Task 相关测试通过。

```powershell
npm run test -- --run --no-file-parallelism src/pages/Evaluations.test.tsx src/pages/Artifacts.test.tsx src/pages/Observability.test.tsx src/api/artifacts.test.ts src/components/Layout.test.tsx
```

结果：5 个测试文件通过，55 个相关回归测试通过。

```powershell
npm run lint
npm run build
git diff --check
```

结果：lint 通过，build 通过；Vite 保留既有 chunk size warning；`git diff --check` 未发现空白错误，仅提示 Windows LF/CRLF 行尾警告。

```powershell
python C:\Users\a\.codex\skills\webapp-testing\scripts\with_server.py --server "npm run preview -- --host 127.0.0.1 --port 4204" --port 4204 --timeout 30 -- python .scratch\v0.29e-remediation-task-invalid-link-recovery\browser-check.py
```

结果：浏览器验收通过。脚本验证无效 `taskId=missing-task` 返回 404 后，Remediation Tasks 看板显示“清除定位”；点击后 URL 移除 `taskId`，错误提示消失，任务列表中的 `remediation-task-2` 仍可见。
