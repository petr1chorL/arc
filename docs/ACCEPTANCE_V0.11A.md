# V0.11A 验收记录：修复任务负责人、截止时间和筛选

> 验收日期：2026-06-27
> 范围：Remediation Task 运营字段与筛选

## 验收结论

V0.11A 已完成实现、自动化验证和浏览器验收。Remediation Task 现在支持负责人、截止时间、逾期判断，并可按负责人、优先级和逾期状态筛选。

## 已实现能力

- 后端持久化 `owner`、`dueDate` 和派生 `isOverdue`。
- 历史 SQLite 表可增量补列 `owner` 和 `due_date`。
- `GET /remediation-tasks` 支持 `owner`、`priority`、`overdue` 查询参数。
- 创建任务时前端带默认负责人和 7 天后截止时间，后端以当前用户作为兜底负责人。
- 前端 Remediation Tasks 区域展示负责人、截止时间和逾期状态。
- 前端提供负责人、优先级和逾期筛选控件。

## 自动化验证

- `apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_evaluations_api.py::test_remediation_tasks_support_owner_due_date_and_filters -q`：通过。
- `npm test -- --run src/pages/Evaluations.test.tsx`：通过。
- `apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q`：通过；存在既有 `StarletteDeprecationWarning`。
- `npm test -- --run`：27 个前端测试文件、95 项测试通过；存在既有 Node `--localstorage-file` warning。
- `npm run lint`：通过。
- `npm run build`：通过；存在既有 Vite chunk size warning。

## 浏览器验收

- URL：`http://127.0.0.1:4173/w/ai-capability-center/evaluations`。
- `Remediation Tasks` 区域可见。
- 负责人筛选、优先级筛选、逾期筛选可见。
- 任务卡展示负责人、截止时间和逾期状态。
- 本次浏览器验证新增 console warning/error：0。
- 截图：`.scratch/v0.11a-remediation-ownership.png`。
- 结果文件：`.scratch/v0.11a-browser-result.json`。
