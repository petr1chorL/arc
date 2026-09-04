# ARC.ONE Netlify 原生全量迁移实施计划

## Phase 0：平台门禁

1. 确认 Free 团队的 Database、Functions、Async Workloads 可用性和 credits 观察方式。
2. 安装固定版本的 `@netlify/functions`、`@netlify/database`、`@netlify/async-workloads` 和 Vite 集成。
3. 先写失败测试：数据库健康 Function、Preview 分支隔离、重复异步事件幂等。
4. 初始化非生产数据库，添加最小 migration 和探针 Function/Workload。
5. 发布 Preview；验证 Function、事务、重试和日志后决定是否进入 Phase 1。

## Phase 1：数据库 Baseline 与迁移工具

1. 从现有 SQLAlchemy 模型和受控 schema-only 导出建立 43 表 baseline。
2. 建立无 Secret 的导出、导入与对账脚本。
3. 使用非生产快照验证表数、行数、主键、外键、状态、汇总和时间边界。
4. 重复执行空库重建和导入，确保结果确定。

## Phase 2：身份与 Workspace

1. 建立统一 Function 路由、安全头、请求 ID、错误与数据库事务基础。
2. 先写旧新契约对比测试，再迁移登录、Session、CSRF、邀请、成员、RBAC 和审计。
3. Preview 浏览器验证登录、刷新、退出、锁定、越权和 Workspace 隔离。

## Phase 3：资产与工作流

1. 按 Agent、Data Object、Tool/Skill、Model Provider、Workflow、Rubric、Golden Sample 顺序迁移。
2. 每个领域先固定 API 契约和状态机失败测试，再实现最小服务与 Repository。
3. 每个领域完成后运行前端回归，不同时改动界面设计。

## Phase 4：运行时与闭环

1. 建立数据库 outbox、Async Workload 事件、条件领取和幂等键。
2. 迁移 Execution、Notification、Schedule、Review、Evaluation、Remediation 和 Observability。
3. 注入超时、重复投递、重试、死信、取消、部署中断和外部服务失败。
4. 验证没有重复副作用，所有状态可审计、可恢复。

## Phase 5：生产切换

1. 记录当前 Zeabur commit、数据库备份和回滚入口。
2. 执行生产迁移演练，获得独立对账报告。
3. 进入维护窗口：冻结写入、最终增量、对账、切换唯一入口和定时任务。
4. 运行真实登录、Workflow、Human Review、Evaluation、Notification 与审计验收。
5. Zeabur 保持只读回退；稳定观察期结束后再执行下线 Issue。

## 每阶段门禁

```powershell
npm test -- --run
npm run lint
npm run build
npm run deploy:check
```

涉及线上行为时额外运行精确 Deploy ID 校验、浏览器核心链路和数据库对账。任何失败都停在当前阶段，
不得跳过验证继续切流。
