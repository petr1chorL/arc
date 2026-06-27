# V0.11B 验收记录：修复任务评论与处理记录

> 验收日期：2026-06-27
> 范围：Remediation Task 评论与处理时间线

## 验收结论

V0.11B 已完成实现、自动化验证和浏览器验收。Remediation Task 现在支持评论、附件引用和状态变化处理记录，任务卡可展示处理时间线。

## 已实现能力

- 后端新增 Remediation Task 活动记录持久化。
- `POST /remediation-tasks/{taskId}/activities` 可创建评论。
- 评论保存正文、附件引用、操作者和时间。
- PATCH 更新任务状态时自动写入状态变化记录。
- 任务列表返回每个任务的活动记录。
- 前端任务卡展示处理时间线。
- 前端支持提交评论和附件引用。

## 自动化验证

- `apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_evaluations_api.py::test_remediation_task_activities_record_comments_and_status_changes -q`：通过。
- `npm test -- --run src/pages/Evaluations.test.tsx`：通过。
- `apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q`：通过；存在既有 `StarletteDeprecationWarning`。
- `npm test -- --run`：27 个前端测试文件、95 项测试通过；存在既有 Node `--localstorage-file` warning。
- `npm run lint`：通过。
- `npm run build`：通过；存在既有 Vite chunk size warning。

## 浏览器验收

- URL：`http://127.0.0.1:4173/w/ai-capability-center/evaluations`。
- `Remediation Tasks` 区域可见处理时间线。
- 评论内容和附件引用输入框可见。
- 提交评论后，时间线出现评论正文和附件引用。
- 本次浏览器验证新增 console warning/error：0。
- 截图：`.scratch/v0.11b-remediation-activity.png`。
- 结果文件：`.scratch/v0.11b-browser-result.json`。
