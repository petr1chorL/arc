# V0.11A 状态

## 当前状态

- 状态：Done
- 分支：`codex/v0.7a-identity-access`
- 范围：修复任务负责人、截止时间和优先级筛选

## 开发清单

- [x] 本地 PRD、Issue、实施计划
- [x] 后端红测
- [x] 后端字段、迁移和过滤实现
- [x] 后端 focused 测试
- [x] 前端红测
- [x] 前端筛选和任务卡实现
- [x] 前端 focused 测试
- [x] 后端全量测试
- [x] 前端全量测试
- [x] `npm run lint`
- [x] `npm run build`
- [x] 浏览器验收

## 当前验证证据

- `apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_evaluations_api.py::test_remediation_tasks_support_owner_due_date_and_filters -q`：通过。
- `npm test -- --run src/pages/Evaluations.test.tsx`：通过。
- `apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q`：通过。
- `npm test -- --run`：通过。
- `npm run lint`：通过。
- `npm run build`：通过。
- 浏览器验收：`.scratch/v0.11a-browser-result.json`，截图 `.scratch/v0.11a-remediation-ownership.png`。
