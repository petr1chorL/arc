# V0.13Q 验收说明：运行中任务租约过期提示

> 日期：2026-06-28

## 本版完成内容

V0.13Q 在执行队列运营区块里补齐运行中任务的租约过期可见性。

- 运行中的队列任务如果 `lockedUntil` 已早于当前时间，任务卡片显示“租约已过期”风险标识。
- 打开该任务详情后，“队列排障建议”会提示该任务可被其他 Worker 接管。
- 未过期的运行中任务仍沿用原有“当前由某 Worker 持有租约”的提示。
- 该能力只使用现有 `ExecutionJob.lockedUntil` 和 `status` 字段，不新增后端 schema。

## 没有完成的内容

- 自动释放租约或手动释放租约按钮。
- 独立队列运营详情页。
- 实时 Worker 心跳推送。
- 对长期过期租约自动创建告警或修复任务。

## 自动化验收

### RED/GREEN 验证

```powershell
npx vitest run src/pages/Observability.test.tsx -t "highlights expired worker leases" --reporter verbose
```

RED 结果：

- 首次失败，因为运行中且租约已过期的队列任务卡片没有显示“租约已过期”。

GREEN 结果：

- 运行中且租约已过期的任务卡片显示“租约已过期”。
- 打开任务详情后展示“队列排障建议”。
- 详情建议中展示“Worker 租约已过期，任务可被其他 Worker 接管；如果长期停留运行中，请检查 Worker 进程。”

### Focused 回归

```powershell
npx vitest run src/pages/Observability.test.tsx --reporter verbose --pool=threads
```

实际结果：

- 观测页 1 个测试文件、10 项测试通过。

### 全量回归

```powershell
$files = rg --files src | Where-Object { $_ -match '\.test\.(ts|tsx)$' }
npx vitest run @($files) --reporter verbose
npm run lint
npm run build
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q
git diff --check
```

实际结果：

- 前端 27 个测试文件、106 项测试通过。
- `npm run lint` 通过。
- `npm run build` 通过，保留 Vite chunk size 既有提示。
- 后端完整测试集通过，保留既有 Starlette/httpx deprecation warning。
- `git diff --check` 仅有 Windows 换行提示，没有 whitespace error。

## 浏览器验收

页面：

```text
http://127.0.0.1:4173/w/ai-capability-center/observability
```

实际结果：

- 观测页“执行队列运营”区块显示运行中任务。
- 运行中任务卡片显示“租约已过期”。
- 点击“查看详情”后展示“队列排障建议”。
- 详情建议展示“Worker 租约已过期，任务可被其他 Worker 接管；如果长期停留运行中，请检查 Worker 进程。”
- 浏览器控制台新增 warning/error 为 0。

验收材料：

- `.scratch/v0.13q-expired-lease-guidance.png`
- `.scratch/v0.13q-browser-result.json`
