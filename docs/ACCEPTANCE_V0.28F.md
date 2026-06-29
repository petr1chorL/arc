# V0.28F 修复任务详情运营字段编辑验收记录

## 版本目标

让 Remediation Task 详情区可以直接修改负责人、优先级和截止时间，并保证后端持久化、处理记录、详情区和任务卡片保持一致。

## 验收范围

- 后端 `PATCH /evaluations/remediation-tasks/{taskId}` 支持 `owner`、`priority`、`dueDate` 可选字段，并要求至少包含一个更新字段。
- `owner` 空字符串或 `null` 保存为未分配；`priority` 只允许 `P0`、`P1`、`P2`。
- 修改运营字段后，响应和后续列表读取都返回新负责人、优先级和截止时间。
- 修改运营字段会写入 `metadata_change` 处理记录。
- 详情区展示 `详情负责人`、`详情优先级`、`详情截止日期` 和“保存任务信息”。
- 从详情区保存后，详情区和任务卡片同步显示新运营字段。

## 已验证命令

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_evaluations_api.py::test_remediation_task_metadata_can_be_updated -q
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_evaluations_api.py::test_remediation_task_metadata_can_be_updated apps/api/tests/test_evaluations_api.py::test_remediation_tasks_can_be_created_listed_and_updated apps/api/tests/test_evaluations_api.py::test_remediation_tasks_support_owner_due_date_and_filters -q
npm run test -- --run src/pages/Evaluations.test.tsx -t "shows failed sample clusters for the latest Regression Run"
npm run test -- --run src/pages/Evaluations.test.tsx
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_evaluations_api.py -q
npm run test -- --run src/pages/Evaluations.test.tsx src/pages/Artifacts.test.tsx src/pages/Observability.test.tsx src/api/artifacts.test.ts src/components/Layout.test.tsx
apps/api/.venv/Scripts/python.exe C:\Users\a\.codex\skills\webapp-testing\scripts\with_server.py --help
$env:ARC_ONE_PORT='4201'; apps/api/.venv/Scripts/python.exe C:\Users\a\.codex\skills\webapp-testing\scripts\with_server.py --server "npm run dev -- --host 127.0.0.1 --port 4201" --port 4201 --timeout 60 -- node .scratch\v0.26c-artifact-catalog-ui\browser-check.mjs
npm run lint
npm run build
git diff --check
```

## 当前验证结果

- 后端 RED 验证：`test_remediation_task_metadata_can_be_updated` 首次失败，失败原因为旧 PATCH 逻辑把缺失的 `status` 写成 `None`，触发 `remediation_tasks.status` 非空约束。
- 后端 GREEN 验证：扩展 `RemediationTaskUpdate` 和 PATCH 逻辑后，元信息编辑测试与相邻修复任务回归共 3 条通过。
- 前端 RED 验证：详情区编辑测试首次失败，失败原因为找不到 `详情负责人` 控件。
- 前端 GREEN 验证：补充详情区元信息表单、前端 PATCH 入参和状态同步后，同一聚焦测试通过。
- `src/pages/Evaluations.test.tsx` 全量通过：16 条测试通过。
- 后端评估 API 回归通过：15 条测试通过。
- 前端相关回归通过：5 个测试文件、50 条测试通过。
- 浏览器关键路径验收通过，覆盖 Artifact 创建修复任务、进入修复任务详情、检查 V0.28F 任务信息控件、详情处理动作、来源链接和运行链路反查。
- `npm run lint` 通过。
- `npm run build` 通过；仅保留 Vite chunk-size warning，非失败。
- `git diff --check` 通过；仅输出 Windows 换行提示，非空白错误。

## 当前限制

- 不新增成员选择器或 Reviewer 绑定。
- 不做批量转派。
- 不做字段级权限差异。
- 不新增独立 Remediation Task 详情 API。
- 不调整任务排序规则。
