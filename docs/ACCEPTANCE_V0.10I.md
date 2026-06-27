# V0.10I 修复任务关联复测验收

## 验收目标

确认已完成的 Remediation Task 可以直接发起针对代表样本的 Regression Run 复测，并把复测证据展示回任务卡。

## 前置条件

- 已登录本地 ARC.ONE。
- 当前 Workspace 至少有 1 个 `done` 状态的 Remediation Task。
- 该任务的 `sourceRunId` 指向包含对应 `sampleIds` Evaluation 记录的 Regression Run。

## 验收步骤

1. 打开 `http://127.0.0.1:4173/w/ai-capability-center/evaluations`。
2. 滚动到 `Remediation Tasks`。
3. 确认已完成任务展示 `发起复测`。
4. 点击 `发起复测`。
5. 确认任务卡展示：
   - `Retest Run`。
   - 复测 Run ID。
   - 通过率。
   - 失败样本数。
6. 刷新页面，确认任务仍展示同一个复测 Run，不重复生成。

## 不通过判定

- `done` 任务没有 `发起复测`。
- 未完成任务可以发起复测。
- 点击复测后没有创建或关联 Regression Run。
- 重复点击复测创建多个重复 Run。
- 任务卡没有展示复测结果。
- 原有任务创建、状态流转、趋势、洞察、失败聚类和修复队列不可用。

## 当前限制

- 不自动把复测失败的任务重新打开。
- 不支持选择额外样本；仅复测任务中的代表样本 ID。
- 不支持定时复测。
- 不发送外部通知。

## 本轮验证证据

- `apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_evaluations_api.py -q -k completed_remediation_task_can_start_retest_run`：1 项通过；覆盖未完成任务 409、已完成任务复测、重复复测去重。
- `apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_evaluations_api.py -q -k remediation`：2 项通过。
- `npm test -- --run src/pages/Evaluations.test.tsx`：13 项通过；覆盖任务完成后发起复测并展示复测结果。
- `apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q`：后端全量通过。
- `npm test -- --run`：27 个前端测试文件、95 项通过。
- `npm run lint`：通过。
- `npm run build`：通过；仅有既有 chunk size 提示。
- 浏览器验收：本地登录会话在评估中心点击 `发起复测` 后，任务卡展示复测 Run、通过率和失败数；本次验证期间新增 console warning/error 为 0。
- 浏览器验收结果：`.scratch/v0.10i-browser-result.json`。
- 截图：`.scratch/v0.10i-remediation-retest.png`。
