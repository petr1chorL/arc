# 04E 本地实施计划

用户2026-09-06确认设计。按下面顺序逐行为RED/GREEN，不批量编写未经验证的实现。
无新的包安装、云端连接、模型调用或生产操作。

## 1. 审核只读目录与路由接缝

文件：`scripts/workflows.test.mjs`、`netlify/functions/_shared/workflows/routes.ts`、
`handler.ts`、`directory.ts`；实际PG验证 `scripts/test-workflows-postgres.mjs`。
先测仅GET目录、固定响应投影、跨空间成员隐藏，再写最小SQL与身份事务。
核对Python `human_tasks.py` 的 group_reviewer_ids 与 ReviewerRead，保留排序和null。
用合成数据库HTTP登录验证目录和四角色，不模拟workspaceContext成功。
命令：`npm test -- --run scripts/workflows.test.mjs`；
`node --experimental-transform-types scripts/test-workflows-postgres.mjs 55432 apps/api/.venv/Scripts/python.exe`。

## 2. 工作流草稿请求契约

文件：`apps/api/tests/test_workflow_migration_contract.py`、`apps/api/app/schemas.py`、
`apps/api/app/main.py`、新`apps/api/app/workflow_http.py`、`scripts/workflow-http-python.py`、
`fixtures/workflow-contract/`、TS `workflows/policy.ts`、`postgres.ts`。
先实际请求固定完整更新/缺省/null/别名/位置数值/Unicode，再测固定字段错误与中文状态。
逐条实现创建/列表/读取/编辑/删除；编辑和删除同一Workflow行锁，审计失败回滚。
命令：项目Python `-m pytest apps/api/tests/test_workflow_migration_contract.py -q -o addopts='' -p no:cacheprovider --basetemp=.scratch/workflow-contract-<本轮唯一后缀>`。

## 3. 校验与发布

文件：`apps/api/app/domain.py`、必要的`workflow_http.py`接缝、
TS `workflows/validation.ts`、`postgres.ts`及上述契约测试。
先测DAG/映射空项/对象路径、Agent/Data Object/Rubric跨空间版本、Human默认组与人数/SLA坏类型。
修改Python目标契约，再用同组fixture实现TS，保留发布前快照语义。
实际PG测试两Session发布、编辑/删除竞争、资产停用、损坏历史、候选版本号冲突和审计失败。
每轮独立SQL核对版本/状态/审计；测试最后独立确认随机schema移除。

## 4. 休眠入口与页面

文件：`netlify/functions/workflows.mts`、`src/api/migrationCapabilities.ts`、
`src/pages/Workflows.tsx`/`.test.tsx`、`scripts/reference-assets-e2e-server.mjs`、
`vite.reference-assets.config.ts`、`e2e/workflow-governance.spec.ts`。
直连Function URL应在读取环境/数据库前404，无生产path。
显式workflows模式加载真实目录，错误不得catch为空数组；切换作用域时隔离异步响应。
发布成功后历史读取失败只能重试GET；运行按钮和处理函数阻断。
浏览器完成草稿/引用/映射/两版历史/刷新，未知API501、零外呼。

## 5. 最终门禁与回执

注册已有CI中的本地PG脚本，不修改生产配置。
运行全量前端、Python，身份与04A–E PG、隔离浏览器、lint/build/deploy:check。
按expert-reviewer的独立Spec/Standards两轴检查权限/隔离/版本/失败路径和夸大完成风险。
同步本片change/review/verify、Issue、项目总览、执行账本与CURRENT_IMPLEMENTATION。
只有全部通过才进入ready-for-human；不自动提交推送或发布。
