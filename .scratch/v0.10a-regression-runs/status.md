# V0.10A 状态

## 当前状态

- 状态：Done
- 分支：codex/v0.7a-identity-access
- 范围：Regression Run 历史

## 开发清单

- [x] 本地 PRD、Issue、实施计划
- [x] 后端红测
- [x] 后端 Regression Run 模型、Schema、API
- [x] 前端红测
- [x] 前端批量回归接入持久化运行历史
- [x] 验收文档
- [x] 测试、lint、build、浏览器验证

## 验证证据

- 后端 focused：`apps\api\.venv\Scripts\python.exe -m pytest apps\api\tests\test_evaluations_api.py -q`，7 passed。
- 前端 focused：`npm test -- --run src/pages/Evaluations.test.tsx`，8 passed。
- 后端全量：`apps\api\.venv\Scripts\python.exe -m pytest apps\api\tests -q`，141 passed。
- 前端全量：`npm test -- --run`，27 个测试文件、90 项测试通过。
- Lint：`npm run lint`，通过。
- Build：`npm run build`，通过；仅有 Vite chunk size warning。
- 浏览器验收：评估中心手动样本运行 Regression Run 成功，刷新后 `Regression Run History` 仍展示该 Run，控制台 error/warn 为 0。
- 截图：`.scratch/v0.10a-regression-run-history.png`。
