# 量规真实发布到执行的集成回归准备

日期：2026-10-27。仅合成隔离PostgreSQL测试，不操作生产，不调用真实模型，不提交/推送/部署。

## 输入、输出与完成判据

输入：现有runtimeTestDatabase随机schema、真实身份初始化/登录、Reference Assets和Rubrics HTTP handlers，及合成complete响应。
输出：真实发布量规保持snake_case数据库快照，经pinnedRubric、独立评估执行器和工作流评估器读取后，LLM评分90及真实evaluations记录；deterministic真实发布不触发模型。
完成判据：CI PostgreSQL中执行新增程序通过，包含发布前后快照未篡改、Provider draft可用、固定版本引用、评分记录持久化、重放不重复外发。静态检查不等于PG运行通过。

## 文件计划

1. 新增`scripts/runtime-rubric-publication-postgres.mjs`：使用真实createPostgresRubricsBackend/createRubricsHandler发布，不手写rubric_versions快照；真实createReferenceAssetsHandler创建Provider，真实身份Cookie/CSRF上下文。
2. 以真实发布版本调用pinnedRubric及enqueueEvaluation；以createGatewayJudgeTransport包装合成complete，验证createClosureExecutor和createWorkflowEvaluator均能消费该版本并写入记录。
3. 同样真实创建/发布deterministic量规，证明无外发分支可用。
4. `scripts/verify-runtime-local.mjs`加入新程序。仅本地node --check、lint/typecheck；真实PG等待CI。

## 当前状态

测试实现完成。主线程负责规范化helper/evaluation.ts及纯测试，本切片未修改它们，未触碰未提交的cutover文件。

## 已完成静态检查

- `node --check scripts/runtime-rubric-publication-postgres.mjs`通过。
- `npm run lint`、`npm run typecheck:netlify`、`git diff --check`通过；后者只有仓库既有CRLF提示。
- 新程序已纳入`scripts/verify-runtime-local.mjs`，没有改变CI工作流或测试fixture。

## 集成场景

- ensureFreshIdentity生成合成管理员，再经真实Identity handler登录并携带Cookie/CSRF调用业务API。
- Reference Assets真实创建draft Provider；Rubrics真实创建/发布LLM量规，并独立查库确认judge_type/judge_model/model_provider_id/pass_score存储与无camel别名。
- pinnedRubric读取真实版本；createGatewayJudgeTransport包装合成complete，分别供createClosureExecutor和createWorkflowEvaluator评估，期望90分与两条持久记录；每路径重放不重复调用。
- 真实发布deterministic量规，经同样两个执行器得到51分，模型调用总数保持2，两条附加记录持久化。
- 执行后再次查库确认两种发布快照未被规范化过程改写。

**真实PG未在本机执行，不声称该集成测试已RED或GREEN；等待CI证据。** 主线程纯测试负责根因RED→GREEN。本文件仅记录新增集成覆盖与静态检查。

运行方式：既有CI设置`ARC_RUNTIME_TEST_PORT=5432`并执行`node scripts/verify-runtime-local.mjs`，或单独执行`node --experimental-transform-types scripts/runtime-rubric-publication-postgres.mjs`；只连接固定loopback合成数据库，随机schema由fixture独立清理。
