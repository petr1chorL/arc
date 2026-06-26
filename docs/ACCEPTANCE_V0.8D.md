# V0.8D Trace ID 与运行链路骨架验收

> 更新日期：2026-06-27

## 本轮目标

V0.8D 为运行观测页补齐轻量 Trace 骨架，让一次工作流运行、节点运行和关联审计事件能够被同一个 `Trace ID` 串起来。

## 页面入口

```text
http://127.0.0.1:4173/w/ai-capability-center/observability
```

## 验收项

- 打开运行观测页并点击任意运行后，右侧详情展示 `Trace ID`。
- “节点执行链路”中每个节点展示自己的 `Span`。
- 第一个节点展示 `父 Span root`。
- 后续节点展示上一个节点的 Span 作为父 Span。
- “审计事件”中展示 `审计 Span ...`，可看出事件挂在哪个节点 Span 下。
- 刷新页面后，Trace ID 与 Span 信息仍然存在。
- 浏览器控制台没有 `warn/error`。

## 自动化验证

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_observability_api.py::test_observability_run_detail_includes_trace_context apps/api/tests/test_v07a_migrations.py::test_v06_records_are_migrated_into_one_default_workspace -q
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_observability_api.py apps/api/tests/test_v07a_migrations.py -q
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q
npm test -- src/pages/Observability.test.tsx
npm test -- --run
npm run lint
npm run build
```

已覆盖：

- 旧运行详情读取时会返回并持久化 `traceId`。
- 节点运行会返回 `spanId` 和 `parentSpanId`。
- 审计事件会返回同一 `traceId` 和关联节点 `spanId`。
- 旧 SQLite 表会通过轻量迁移补出 Trace/Span 列。
- 前端会展示 Trace ID、节点 Span、父 Span 和审计 Span。

## 浏览器验证记录

- 使用本地浏览器打开观测页详情，页面展示 `Trace ID`。
- 节点链路展示 `Span ...` 与 `父 Span root`。
- 后续节点展示父 Span 指向上一节点 Span。
- 审计事件展示 `审计 Span ...`。
- 刷新后 Trace 与 Span 信息仍可见。
- 浏览器 console `warn/error` 为空。
- 验收过程中创建的 `v08d-*` 临时本地账号已清理。

## 范围外

- 不接 OpenTelemetry、Tempo、Jaeger、Langfuse。
- 不做跨服务分布式 Trace 采集。
- 不做实时日志查询。
- 不做运行回放。
