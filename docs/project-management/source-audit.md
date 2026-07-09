# ARC.ONE 源码盘点

> 盘点日期：2026-07-03  
> 范围：前端 `src/`、后端 `apps/api/`、E2E、`.scratch/`、`docs/`。  
> 排除：`.env`、数据库文件、依赖目录、虚拟环境和构建产物。

## 本轮结论

当前 `master` 已归并 `codex/v0.7a-identity-access`，项目基线推进到 V1.0 Lite，并包含 V0.7A 到 V0.31F 的连续实现、验收文档和交付脚本。此前只盘点旧 `master`，因此版本台账曾明显少记。详见 `docs/project-management/branch-audit.md`。

V1.0 Lite 是轻量可运行版口径，不等同于 `docs/PROJECT_MASTER_PLAN.md` 中的 V1.0 企业生产版。

## 当前源码能力

| 能力 | 源码证据 | 判断 |
|---|---|---|
| Agent 创建、编辑、发布、停用、测试运行 | `apps/api/app/main.py`、`src/pages/Agents.tsx`、`src/pages/AgentDetail.tsx` | 已实现 |
| AgentVersion 不可变快照 | `AgentVersionRecord`、`publish_agent` | 已实现 |
| Workflow 草稿保存、重载、发布 | `WorkflowRecord`、`WorkflowVersionRecord`、`src/pages/Workflows.tsx` | 已实现 |
| DAG 校验 | `apps/api/app/domain.py` | 已实现基础校验 |
| 真实模型调用端口 | `apps/api/app/model_gateway.py` | 已实现 OpenAI-compatible 网关 |
| Run / NodeRun / Artifact 持久化 | `apps/api/app/execution.py`、`apps/api/app/models.py` | 已实现 |
| Human Task 暂停、会签、恢复、重跑、终止 | `apps/api/app/human_tasks.py`、`WorkflowResumeService` | 已实现 |
| FeedbackCandidate / GoldenSample | `FeedbackCandidateRecord`、`GoldenSampleRecord` | 已实现 |
| SLA 刷新与 Outbox | `HumanTaskService.refresh_sla`、`NotificationOutboxRecord` | 已实现读取/操作时刷新 |
| V0.7A 安全原语 | `apps/api/app/security.py`、`test_security.py` | 已实现密码哈希和 token digest |

## 仍未实现或只是原型

| 能力 | 现状 |
|---|---|
| 登录、Session、CSRF API | 只有配置项和安全原语；没有 auth router、SessionRecord、UserRecord |
| Workspace / RBAC | Layout 只是展示“安克创新 / AI 能力中心”；API 仍是匿名旧路径 |
| Reviewer 绑定真实用户 | 审核工作台仍有“当前操作者”下拉；请求体传 `reviewerId/actorId` |
| 评估中心真实闭环 | `src/pages/Evaluations.tsx` 仍读 `src/data/mock.ts` |
| 运营总览真实指标 | `src/pages/Dashboard.tsx` 仍读 `src/data/mock.ts` |
| Schema / Data Object 资产 | 只有 V0.24E 文档和计划，源码未见正式 Schema 资产实现 |
| Remediation | 只有空 `.scratch` 目录，未见源码或领域定义 |
| 实时事件、Trace、日志和运行回放 | 未见 WebSocket/SSE/Trace 实现 |
| 生产迁移和部署 | SQLite 轻量增量迁移存在；Alembic、Docker 运行验证和 CI/CD 未完成 |

## 最新验证

| 命令 | 结果 |
|---|---|
| `apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q` | 34 passed，1 个 Starlette/httpx deprecation warning |
| `npm test -- --run` | 13 files / 30 tests passed |
| `npm run lint` | passed |
| `npm run build` | passed |

## 文档偏差

| 文档 | 偏差 | 建议 |
|---|---|---|
| `README.md` | 原先仍称“真实大模型与执行未实现” | 本轮已修正为 V0.6 当前状态 |
| `docs/PROJECT_MASTER_PLAN.md` | 当前状态章节早于 V0.6 | 后续单独更新，不在本轮大改 |
| `.scratch/v0.7a-identity-access/` | 实施计划要求 7 个 issue，但当前只有 01 | 补齐 PRD/status/02-07 issue 后再继续开发 |
| `.scratch/v1.0-lite/` | 原先缺失 | 本轮已新增 status，仍需补 PRD 和验收清单 |
| `.scratch/v0.16d` 等目录 | 只有目录或空 issues | 标为 placeholder，不删除也不当作完成 |

## 下一步建议

1. 以合并后的 `master` 为事实源，继续刷新当前状态文档和 V1.0 Lite 试点边界。
2. 针对试点关键路径补齐后端测试、前端测试、lint、build 和关键浏览器验收。
3. 单独安排一次 `docs/PROJECT_MASTER_PLAN.md` 总蓝图刷新，避免新成员误读旧状态。
