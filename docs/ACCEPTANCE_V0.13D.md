# V0.13D 验收说明：执行队列运营入口

> 日期：2026-06-27

## 本版完成内容

V0.13D 给异步执行队列补齐第一版可见运营入口。

- 新增 `GET /execution-jobs` 后端接口。
- 支持通过 `status` 查询参数筛选队列任务。
- 返回 Run、Workflow、状态、尝试次数、最大尝试次数、错误、租约 worker、租约到期、heartbeat 和死信时间。
- 前端新增 `listExecutionJobs` API client。
- 运行观测页新增“执行队列运营”卡片，展示排队中、运行中、已完成和死信数量。
- 队列卡片展示最近任务、Run/Workflow 摘要、尝试次数、锁持有者、租约到期和错误原因。

## 没有完成的内容

- 独立的队列运营详情页。
- 前端手动重试、释放租约、重新投递死信任务。
- 队列任务分页、排序和复杂筛选。
- 常驻后台 worker。

## 自动化验收

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_execution_api.py::test_execution_jobs_list_supports_status_filter_and_operational_fields -q
npm test -- --run src/api/execution.test.ts src/pages/Observability.test.tsx
```

预期结果：

- 后端 1 项通过。
- 前端 2 个测试文件、9 项测试通过。
- 覆盖队列列表接口、状态筛选、运营字段，以及运行观测页的执行队列运营卡片。

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q
npm test -- --run
npm run lint
npm run build
```

预期结果：

- 后端 177 项通过。
- 前端 27 个测试文件、99 项测试通过。
- Oxlint 通过。
- TypeScript 编译与 Vite 生产构建通过。
