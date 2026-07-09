# V0.10H 失败修复任务验收

## 验收目标

确认评估中心不只展示修复建议，还能把 `Failure Remediation Queue` 中的修复项沉淀为可追踪任务，并完成状态流转。

## 前置条件

- 已登录本地 ARC.ONE。
- 当前 Workspace 至少有 1 次包含失败样本的 Regression Run。
- 评估中心能看到 `Failure Pattern Summary` 与 `Failure Remediation Queue`。

## 验收步骤

1. 打开 `http://127.0.0.1:4173/w/ai-capability-center/evaluations`。
2. 滚动到 `Regression Run History` 的趋势区。
3. 确认出现 `Failure Remediation Queue`。
4. 在任一修复项上点击 `创建任务`。
5. 确认页面出现 `Remediation Tasks` 区块。
6. 确认任务展示：
   - 修复标题，如 `修复 Evidence 偏低`。
   - 优先级，如 `P1`。
   - 当前状态 `open`。
   - 关联样本数。
   - 原因组，如 `Evidence`。
7. 点击 `标记处理中`，确认状态变成 `in_progress`。
8. 点击 `标记完成`，确认状态变成 `done`。
9. 再次对同一个修复项点击创建时，应展示已创建任务或返回已有任务，不产生重复待办。

## 不通过判定

- 有修复队列但没有 `创建任务`。
- 点击创建后没有 `Remediation Tasks`。
- 任务不能从 `open` 流转到 `in_progress` 和 `done`。
- 相同 `sourceRunId + clusterKey` 产生重复任务。
- 原有趋势、洞察、失败聚类、修复队列、Run 详情或 Run 对比不可用。

## 当前限制

- 修复任务暂不支持负责人、截止时间和评论。
- 修复任务不会自动触发 Regression Run 复测。
- 修复任务不会发送外部通知。
- 修复建议仍来自确定性规则，不调用 LLM。

## 本轮验证证据

- `apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_evaluations_api.py -q -k remediation`：1 项通过；覆盖创建、重复创建返回已有任务、列表读取和状态更新。
- `npm test -- --run src/pages/Evaluations.test.tsx`：13 项通过；覆盖从修复队列创建任务、展示任务列表、标记处理中和标记完成。
- `apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q`：后端全量测试通过。
- `npm test -- --run`：27 个前端测试文件、95 项测试通过。
- `npm run lint`：Oxlint 通过。
- `npm run build`：TypeScript 编译与 Vite 生产构建通过；仅有既有 chunk size 提示。
- 浏览器验收：本地登录会话在评估中心从 `Failure Remediation Queue` 创建 1 个任务，状态从 `open` 流转到 `in_progress`，再到 `done`。
- 浏览器验收结果：`.scratch/v0.10h-browser-result.json`；本次验证开始后的新增 console warning/error 为 0。
- 截图：`.scratch/v0.10h-remediation-tasks.png`。
