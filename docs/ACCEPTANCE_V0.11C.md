# V0.11C 复测失败回流验收记录

## 版本目标

当修复任务复测失败时，系统自动把任务从 `done` 回流到 `in_progress`，并在处理时间线和评估闭环看板中体现未关闭风险。

## 已实现能力

- 未完成修复任务发起复测仍返回 409。
- 已完成修复任务复测失败后自动回流为 `in_progress`。
- 失败复测 Run 会写回 `retestRunId` 和 `retestRun`。
- 任务时间线写入 `retest_failed` 和 `status_change`。
- 回流任务再次标记完成时清理旧失败复测引用，允许新一轮复测。
- 前端任务卡展示“复测失败已回流”。
- Evaluation Loop Board 将回流任务计为未关闭风险。

## 验收命令

- `apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_evaluations_api.py::test_failed_remediation_retest_reopens_task_and_can_be_retested_again -q`：通过。
- `npm test -- --run src/pages/Evaluations.test.tsx`：通过。
- `apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q`：通过。
- `npm test -- --run`：27 个测试文件、95 条测试通过。
- `npm run lint`：通过。
- `npm run build`：通过。

## 浏览器验收

- 页面：`http://127.0.0.1:4173/w/ai-capability-center/evaluations`
- 验收动作：在评估中心对已完成修复任务点击“发起复测”。
- 结果：任务回流为 `in_progress`，任务卡显示“复测失败已回流”，时间线显示“复测未通过”和“状态变更：done -> in_progress”，Evaluation Loop Board 显示“未关闭风险 1”。
- 刷新后：Retest Run 摘要、回流徽标、时间线和未关闭风险仍可见。
- 新起点后的浏览器 console warning/error：0。
- 截图：`.scratch/v0.11c-retest-loopback.png`
- 结果文件：`.scratch/v0.11c-browser-result.json`

## 已知非阻断警告

- Pytest 仍有既有 `StarletteDeprecationWarning`。
- Vitest 仍有既有 Node `--localstorage-file` warning。
- Vite build 仍有既有 chunk size warning。
