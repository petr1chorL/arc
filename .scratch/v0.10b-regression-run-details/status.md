# V0.10B 状态

## 当前状态

- 状态：Done
- 分支：codex/v0.7a-identity-access
- 范围：Regression Run 详情与筛选

## 开发清单

- [x] 本地 PRD、Issue、实施计划
- [x] 后端详情 API 红测
- [x] 后端详情 API 实现
- [x] 前端详情与筛选红测
- [x] 前端筛选和详情弹窗实现
- [x] 验收文档
- [x] 测试、lint、build、浏览器验证

## 验证证据

- 后端红测：`apps\api\.venv\Scripts\python.exe -m pytest apps\api\tests\test_evaluations_api.py -q` 先因详情 API 缺失返回 404 而失败。
- 前端红测：`npm test -- --run src/pages/Evaluations.test.tsx` 先因找不到 `Run Rubric 筛选` 而失败。
- 后端 focused：`apps\api\.venv\Scripts\python.exe -m pytest apps\api\tests\test_evaluations_api.py -q`，9 passed。
- 前端 focused：`npm test -- --run src/pages/Evaluations.test.tsx`，9 passed。
- 后端全量：`apps\api\.venv\Scripts\python.exe -m pytest apps\api\tests -q` 通过。
- 前端全量：`npm test -- --run`，27 个测试文件、91 项测试通过。
- Lint：`npm run lint` 通过。
- Build：`npm run build` 通过；Vite 仍有既有 chunk size warning。
- 浏览器验收：`/evaluations` 页面可筛选 Regression Run，点击 `查看 Run 详情` 可打开详情弹窗，展示 Run 上下文与样本级 Evaluation 明细；浏览器日志无 error/warn。
- 截图：`.scratch/v0.10b-regression-run-detail.png`。
