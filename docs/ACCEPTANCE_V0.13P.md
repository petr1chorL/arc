# V0.13P 验收说明：队列排障建议

> 日期：2026-06-28

## 本版完成内容

V0.13P 在执行队列任务详情里新增排障建议。

- 队列任务详情新增“队列排障建议”区块。
- 根据任务状态、尝试次数、最大尝试次数、错误信息、锁和下次尝试时间派生处理建议。
- 死信任务展示先复核失败原因和上游依赖，再决定是否重新入队。
- 达到最大尝试次数时提示修复配置或输入后再重新入队。
- 有错误信息时展示“当前错误：...”。
- 排队退避、运行中租约、已取消、已完成也有对应提示。

## 没有完成的内容

- 后端持久化的排障建议字段。
- LLM 生成的动态排障建议。
- 与 Run / NodeRun 失败分类合并后的统一建议。
- 一键创建修复任务。

## 自动化验收

### RED/GREEN 验证

```powershell
npm test -- --run src/pages/Observability.test.tsx -t "shows troubleshooting guidance" --reporter verbose
```

RED 结果：

- 首次失败，因为队列任务详情没有“队列排障建议”区块。

GREEN 结果：

- 打开死信任务详情后展示“队列排障建议”。
- 展示死信处理建议。
- 展示最大尝试次数建议。
- 展示当前错误建议。

### Focused 回归

```powershell
npx vitest run src/pages/Observability.test.tsx --reporter verbose
```

实际结果：

- 观测页 1 个测试文件、9 项通过。

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

- 前端 27 个测试文件、105 项测试通过。
- `npm run lint` 通过。
- `npm run build` 通过，保留 Vite chunk size 既有提示。
- 后端完整测试集通过。
- `git diff --check` 仅有 Windows 换行提示，没有 whitespace error。

## 浏览器验收

页面：

```text
http://127.0.0.1:4173/w/ai-capability-center/observability
```

实际结果：

- 打开死信任务详情后展示“队列排障建议”。
- 展示“已进入死信队列，先复核失败原因和上游依赖，再决定是否重新入队。”
- 展示“已达到最大尝试次数 3/3，建议修复配置或输入后再重新入队。”
- 展示“当前错误：V0.13P browser troubleshooting check”。
- 浏览器控制台新增 warning/error 为 0。

验收材料：

- `.scratch/v0.13p-queue-troubleshooting-guidance.png`
- `.scratch/v0.13p-browser-result.json`

