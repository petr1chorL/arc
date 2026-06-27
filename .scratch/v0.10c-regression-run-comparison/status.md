# V0.10C 状态

## 当前状态

- 状态：Done
- 分支：codex/v0.7a-identity-access
- 范围：Regression Run 对比

## 开发清单

- [x] 本地 PRD、Issue、实施计划
- [x] 前端 Run 对比红测
- [x] 前端 Run 对比计算与交互实现
- [x] 验收文档
- [x] 测试、lint、build、浏览器验证

## 验证证据

- 红测：`npm test -- --run src/pages/Evaluations.test.tsx` 先因找不到 `基准 Run` 失败。
- focused 测试：`npm test -- --run src/pages/Evaluations.test.tsx`，10 passed。
- 后端全量：`apps\api\.venv\Scripts\python.exe -m pytest apps\api\tests -q` 通过。
- 前端全量：`npm test -- --run`，27 个测试文件、92 项测试通过。
- Lint：`npm run lint` 通过。
- Build：`npm run build` 通过；仍有既有 Vite chunk size warning。
- 浏览器验收：创建两次 Regression Run 后，在评估中心选择基准/目标 Run 并点击对比，页面展示 4 张样本变化卡；浏览器 error/warn 日志为 0。
- 截图：`.scratch/v0.10c-regression-run-comparison.png`。
- 浏览器结果：`.scratch/v0.10c-browser-result.json`。
