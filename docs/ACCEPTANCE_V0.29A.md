# V0.29A 验收记录：修复任务详情复测风险摘要

## 范围

- Remediation Task API 返回 `retestSummary`。
- 修复任务详情区展示“复测风险摘要”。
- 未复测、复测失败和复测通过三种摘要状态由后端统一派生。
- 不新增数据库字段，不改变复测状态机。

## RED 证据

- 后端：`apps\api\.venv\Scripts\python.exe -m pytest apps/api/tests/test_evaluations_api.py::test_failed_remediation_retest_reopens_task_and_can_be_retested_again -q`
  - 初始结果：失败，`KeyError: 'retestSummary'`。
- 前端：`npm run test -- --run src/pages/Evaluations.test.tsx -t "shows failed sample clusters for the latest Regression Run"`
  - 初始结果：失败，详情区找不到“复测风险摘要”。

## GREEN 证据

- 后端聚焦测试：
  - 命令：`apps\api\.venv\Scripts\python.exe -m pytest apps/api/tests/test_evaluations_api.py::test_failed_remediation_retest_reopens_task_and_can_be_retested_again -q`
  - 结果：`1 passed`。
- 前端聚焦测试：
  - 命令：`npm run test -- --run src/pages/Evaluations.test.tsx -t "shows failed sample clusters for the latest Regression Run"`
  - 结果：`1 passed | 15 skipped`。

## 最终验证

- 后端相关回归：
  - 命令：`apps\api\.venv\Scripts\python.exe -m pytest apps/api/tests/test_evaluations_api.py -q`
  - 结果：`15 passed`。
- 前端相关回归：
  - 命令：`npm run test -- --run --no-file-parallelism src/pages/Evaluations.test.tsx src/pages/Artifacts.test.tsx src/pages/Observability.test.tsx src/api/artifacts.test.ts src/components/Layout.test.tsx`
  - 结果：`5 passed / 50 passed`。
  - 说明：同一批文件并行执行时出现 Vitest 超时；逐文件和 `--no-file-parallelism` 均通过。
- 浏览器关键路径：
  - 命令：`$env:ARC_ONE_PORT='4201'; apps\api\.venv\Scripts\python.exe C:\Users\a\.codex\skills\webapp-testing\scripts\with_server.py --server "npm run dev -- --host 127.0.0.1 --port 4201" --port 4201 --timeout 60 -- node .scratch\v0.26c-artifact-catalog-ui\browser-check.mjs`
  - 结果：`{"ok":true,"screenshotPath":"D:\\project\\安克知识沉淀\\.worktrees\\v0.7a-identity-access\\.scratch\\v0.26c-artifact-catalog-ui\\browser-artifacts.png"}`。
- Lint：
  - 命令：`npm run lint`
  - 结果：通过。
- Build：
  - 命令：`npm run build`
  - 结果：通过；保留既有 Vite chunk-size warning。
- Diff 检查：
  - 命令：`git diff --check`
  - 结果：通过；仅出现 Windows LF/CRLF 提示，无空白错误。
