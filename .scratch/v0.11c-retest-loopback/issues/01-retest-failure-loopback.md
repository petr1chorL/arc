# Issue 01: 复测失败自动回流修复任务

## 用户价值

作为评估负责人，我需要复测失败的修复任务自动回到处理中，这样我不会把仍然失败的问题误认为已经关闭。

## 实现要求

- 后端在修复任务复测完成后判断 `failed_samples`。
- 如果失败数大于 0：
  - 任务状态从 `done` 改为 `in_progress`。
  - 写入 `retest_failed` 活动。
  - 写入 `status_change` 活动。
- 如果失败数等于 0：
  - 保持 `done`。
  - 写入 `retest_passed` 活动。
- 当任务从非 `done` 再次标记为 `done` 时，清理旧的失败 `retest_run_id`，允许重新复测。
- 前端在任务卡展示复测失败回流状态。

## 验收标准

- Pytest 覆盖失败复测回流和再次完成后可重测。
- Vitest 覆盖任务卡 UI 与闭环看板未关闭风险。
- `npm run lint` 通过。
- `npm run build` 通过。
- 浏览器验收页面无新增 console error/warn。

