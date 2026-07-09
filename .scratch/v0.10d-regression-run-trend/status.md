# V0.10D 状态

## 当前状态

- 状态：Done
- 分支：`codex/v0.7a-identity-access`
- 范围：Regression Run 趋势视图

## 开发清单

- [x] 本地 PRD、Issue、实施计划
- [x] 前端趋势视图红测
- [x] 前端趋势计算与 UI 实现
- [x] 验收文档
- [x] Focused 测试：`npm test -- --run src/pages/Evaluations.test.tsx`
- [x] 后端全量测试
- [x] 前端全量测试
- [x] `npm run lint`
- [x] `npm run build`
- [x] 浏览器验收

## 当前验证证据

- 2026-06-27：新增 `shows Regression Run trend across recent runs`，先失败于缺少 `Regression Run Trend` 区块。
- 2026-06-27：实现趋势计算与 UI 后，`src/pages/Evaluations.test.tsx` 11 项通过。
- 2026-06-27：`apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q` 通过。
- 2026-06-27：`npm test -- --run` 通过，27 个测试文件、93 项测试。
- 2026-06-27：`npm run lint` 通过。
- 2026-06-27：`npm run build` 通过。
- 2026-06-27：浏览器验收通过，截图 `.scratch/v0.10d-regression-run-trend.png`，结果 `.scratch/v0.10d-browser-result.json`。
