# ARC.ONE Netlify 原生全量迁移设计

## 决策

最终目标只保留 Netlify，但迁移期间采用 Strangler 切片，Zeabur 保持现有生产主写，直到 Netlify
完成数据对账和端到端验收。FastAPI 不做非官方打包，API 以 TypeScript Netlify Functions 重写。

## 目标架构

```text
Browser
  -> Netlify CDN (React/Vite)
  -> /api/* Netlify Functions
       -> Netlify Database (PostgreSQL)
       -> Async Workloads (execution / notification / remediation)
       -> external model / tool / agent endpoints
  -> Scheduled Function
       -> enqueue due schedule events only
```

## API 与领域层

- 一个入口函数负责 HTTP 路由、请求 ID、安全头和统一错误序列化。
- 身份、Workspace、Agent、Workflow、Execution、Review、Evaluation、Observability 按领域模块拆分。
- Repository 负责参数化 SQL 和事务；应用服务负责状态机、权限和审计。
- 迁移期间使用契约对比测试保证状态码、JSON 字段、Cookie 和错误语义一致。

## 数据层

- `netlify/database/migrations/` 保存只向前、可重复审查的 PostgreSQL migration。
- 首个 baseline 只定义现有结构，不混入业务重构。
- 数据搬迁分为非生产演练、生产快照、最终增量、对账和切流。
- 破坏性 schema 变化采用 expand/migrate/contract，不与平台迁移同批执行。

## 异步执行

- API 事务创建业务记录与 outbox，再发送仅含业务 ID、事件 ID 和幂等键的事件。
- Async Workload 每一步从数据库读取当前状态，通过条件更新获得执行权。
- 外部模型、Tool、Agent 和通知调用保留业务幂等键；平台重试不能成为唯一幂等保障。
- Scheduled Function 受 30 秒限制，只扫描有限批次并派发事件。
- 单步预计超过运行上限时拆分为多个持久化步骤，不在 Function 内等待。

## 身份与安全

- 前端与 API 使用同一 Netlify Origin，不再需要跨平台 Origin 例外。
- Session Token 只存摘要；Session Cookie 为 HttpOnly、Secure、SameSite=Lax。
- CSRF Cookie 由前端读取并以 Header 回传；Origin、CSRF、RBAC 和 Workspace 隔离均保留。
- Secret 只放 Netlify Environment Variables，业务记录只保存 Secret Ref。

## 切换与回滚

1. Netlify Preview 完成每个领域的契约验证。
2. 非生产数据快照完成迁移演练和对账。
3. 生产进入短时写入冻结，导出最终快照/增量。
4. Netlify 数据校验通过后切换唯一入口与定时任务。
5. Zeabur 保持只读回退，不允许与 Netlify 同时主写。
6. 稳定观察期后再单独批准关闭 Zeabur。

## 第一性原理与对抗式结论

平台整合的价值是减少入口和运维面，不值得用数据丢失、权限退化或任务重复交换。
因此第一步必须是平台门禁，最后一步才是 Zeabur 下线；任何中间成功都不能提前宣称完成。
