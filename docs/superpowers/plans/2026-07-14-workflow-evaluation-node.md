# 工作流评估节点实施计划

## 目标与边界

完成 Issue 01 的最小端到端闭环：用户在现有评估模板表单中配置稳定维度、评分标准、
Model Provider 和模型，发布模板版本；在工作流中添加评估节点并固定选择该版本；Runtime
对唯一上游产出物评分；运行详情展示系统计算的整数总分、通过状态、总评理由，以及每个维度
的分数、权重、两位小数加权分和理由。

本计划不实施 Issue 02：不重构评估中心信息架构，不迁移质量运营路由，不删除 Golden Set、
Regression 或 Remediation。`Evaluations.tsx` 只补齐 Issue 01 必需的模板字段和校验。

## 已确认假设

- 总分沿用现有 `EvaluationRecord.score` 与 `NodeRun.score` 的 0-100 整数契约。
- `weightedScore` 保留两位小数。
- 评估节点恰好一条入边；低分是成功的评估结果，不自动创建 Human Review。
- 工作流发布时固定明确的 Rubric Version，不在运行时漂移到最新版本。
- 模型只返回逐维度分数、逐维度理由和总评理由；名称、权重、总分和通过状态由系统生成。
- Provider 名称、Provider ID 和实际模型属于可展示的非敏感追溯字段；Base URL、Secret Ref 和
  密钥不得进入公开快照、节点输出或错误。
- 历史 Gate 节点继续可加载和渲染，但新增面板不再提供尚无真实 Runtime 语义的 Gate。

## 完成判据

1. 新增行为测试先因目标能力缺失而失败，再由最小实现转绿。
2. Agent -> Evaluation -> End 生成独立 Evaluation NodeRun 与 Evaluation Record。
3. 输出逐维度分数和理由；系统拒绝缺失、重复、额外维度、越界分数和空理由。
4. 工作流发布拒绝不兼容模板、跨 Workspace、停用 Provider、零/多入边。
5. 低分继续后继节点且不隐式创建人工审核；Judge 失败停止后继节点。
6. 现有直接评估、Regression/Remediation、Agent/Human Workflow 行为不回归。
7. 聚焦测试、全量测试、lint、build、部署检查、浏览器路径和 `git diff --check` 全部通过。

## Task 0：记录基线

Files：不修改。

运行：

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_evaluations_api.py apps/api/tests/test_judge_gateway.py apps/api/tests/test_model_gateway.py apps/api/tests/test_workflow_lifecycle_api.py apps/api/tests/test_execution_api.py -q
npm test -- --run src/api/evaluations.test.ts src/pages/Evaluations.test.tsx src/components/WorkflowNode.test.tsx src/pages/Workflows.test.tsx src/pages/Runs.test.tsx
```

验证：当前测试在未实现新能力前全部通过；记录测试数量。若基线失败，先定位已有问题，不把它
混入本功能实现。

## Task 1：Rubric Provider 持久化迁移

Files：

- Modify: `apps/api/tests/test_migrations.py`
- Modify: `apps/api/app/models.py`
- Modify: `apps/api/app/migrations.py`

### 1.1 RED

在 `test_migrations.py` 新增 `test_existing_rubrics_table_adds_model_provider_id`，从缺少该列的
旧数据库启动应用，断言迁移后 `rubrics.model_provider_id` 存在且允许旧记录为 `NULL`。

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_migrations.py::test_existing_rubrics_table_adds_model_provider_id -q
```

预期：因缺少列而失败。

### 1.2 GREEN

仅增加 `RubricRecord.model_provider_id` 及现有启动迁移中的补列逻辑，不新增独立迁移框架。
重跑单测，预期通过。

## Task 2：严格的评估模板契约

Files：

- Modify: `apps/api/tests/test_evaluations_api.py`
- Modify: `apps/api/app/schemas.py`
- Modify: `apps/api/app/main.py`
- Modify: `src/api/evaluations.ts`
- Modify: `src/api/evaluations.test.ts`
- Modify: `src/types.ts`
- Modify: `src/pages/Evaluations.tsx`
- Modify: `src/pages/Evaluations.test.tsx`

### 2.1 后端 RED

新增以下测试：

- `test_rubric_create_generates_stable_dimension_ids_and_persists_criteria`
- `test_rubric_validation_rejects_duplicate_dimension_ids_and_names`
- `test_llm_rubric_publish_requires_usable_workspace_model_provider`

覆盖维度 `id`、非空 `criteria`、ID/标准化名称唯一、权重合计 100、编辑重命名保留 ID，
以及 LLM 模板必须绑定同 Workspace、配置完整且未停用的 Provider 和非空模型。跨 Workspace
与停用 Provider 发布失败；旧模板可以读取，但不可被发布为工作流兼容版本。

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_evaluations_api.py -k "stable_dimension_ids or duplicate_dimension or usable_workspace_model_provider" -q
```

预期：新字段缺失或新校验不存在而失败。

### 2.2 后端 GREEN

- `RubricDimensionWrite/Read` 增加 `id` 与 `criteria`，读取旧数据时保持兼容。
- `RubricWrite/Read` 增加 `modelProviderId`。
- 创建时为缺失 ID 生成稳定标识；编辑时按 ID 保留既有身份。
- 发布时校验 Provider、模型和完整维度契约。
- Rubric Version 快照固定 Provider ID、模型、维度 ID 和 criteria，不包含任何密钥配置。

重跑聚焦测试与既有 Rubric 生命周期测试。

### 2.3 前端 RED/GREEN

先在 API 与页面测试中断言：

- 请求和响应包含 `dimension.id/criteria` 与 `modelProviderId`。
- 模板表单可选择配置完整且未停用的 Provider、填写模型和每维评分标准。
- 维度名称/ID 重复、criteria 为空、权重非 100 时不可提交或发布。
- 历史模板缺字段时页面不崩溃，并明确提示需补齐后才能用于工作流。

再最小修改类型、API 和现有模板表单；不移动或删除页面内其他质量运营模块。

```powershell
npm test -- --run src/api/evaluations.test.ts src/pages/Evaluations.test.tsx
```

## Task 3：Judge 输出、重试与用量契约

Files：

- Modify: `apps/api/tests/test_judge_gateway.py`
- Modify: `apps/api/tests/test_model_gateway.py`
- Modify: `apps/api/app/judge_gateway.py`
- Modify: `apps/api/app/model_gateway.py`

### 3.1 RED

新增/改写：

- `test_model_judge_gateway_parses_dimension_reasons`
- `test_model_judge_gateway_ignores_model_reported_totals_and_weights`
- `test_model_judge_gateway_retries_invalid_dimension_contract`
- `test_model_judge_gateway_failure_reports_accumulated_usage`
- `test_explicit_model_overrides_global_default_model`

参数化覆盖无效 JSON、缺失/重复/额外维度、越界分数、空维度理由和空总评理由。断言每次失败
重试的 Token 都累计；最终错误脱敏但保留用量和 attempts；显式模型优先于全局默认。

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_judge_gateway.py apps/api/tests/test_model_gateway.py -q
```

预期：当前旧响应契约与模型优先级使测试失败。

### 3.2 GREEN

- Judge 请求只要求 `overallReason` 与 `dimensions[{dimensionId,score,reason}]`。
- 按模板维度 ID 严格核对集合与唯一性。
- 忽略模型自报名称、权重、总分和状态。
- 结果和失败对象都携带实际模型、累计 Token 与 attempts。
- 保留有限重试，不增加确定性假分或其他兜底。
- ModelGateway 改为显式模型优先，只有旧调用缺省时才使用全局默认。

重跑 Task 3 测试，预期全部通过。

## Task 4：提取共享 Evaluation Service

Files：

- Add: `apps/api/app/evaluation_service.py`
- Add: `apps/api/tests/test_evaluation_service.py`
- Modify: `apps/api/app/main.py`
- Modify: `apps/api/tests/test_evaluations_api.py`

### 4.1 RED

新增：

- `test_evaluation_service_computes_and_persists_explainable_result`
- `test_evaluation_service_rejects_unavailable_provider_without_record`
- `test_evaluation_service_preserves_legacy_deterministic_path`
- `test_llm_evaluation_uses_provider_and_returns_system_computed_reasons`

断言系统计算每维加权分、整数总分与 `passed`；记录总评/逐维理由、模板版本、Provider、模型和
被评估对象；失败不创建成功记录；旧 deterministic 直接评估继续工作。

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_evaluation_service.py apps/api/tests/test_evaluations_api.py -k "evaluation_service or uses_provider" -q
```

预期：服务不存在或 API 仍内联旧逻辑而失败。

### 4.2 GREEN

新增无 `HTTPException` 的 `EvaluationService`：

- 按 Workspace、Rubric ID、明确 Version ID 获取模板快照。
- 再次校验模板和 Provider 可用状态。
- 调用 Judge，校验结果，系统算分，并创建但不自行提交 `EvaluationRecord`。
- 返回 `evaluationRecordId/templateId/templateVersion/modelProviderId/modelProviderName/model`
  以及完整评分结果。
- 错误对象只暴露脱敏信息和必要用量。

`main.py` 在 HTTP 边界映射领域错误，并让直接评估及 Regression 兼容路径复用同一服务。重复
逻辑只删除本次提取产生的冗余，不重构无关端点。

## Task 5：工作流发布校验与版本固定

Files：

- Modify: `apps/api/tests/test_workflow_lifecycle_api.py`
- Modify: `apps/api/app/domain.py`
- Modify: `apps/api/app/main.py`（仅在需要数据库上下文校验时）

### 5.1 RED

新增：

- `test_workflow_publish_requires_one_incoming_edge_for_evaluation_node`
- `test_workflow_publish_rejects_incompatible_or_cross_workspace_rubric_ref`
- `test_workflow_version_freezes_explicit_rubric_version_ref`

覆盖缺失引用、零入边、多入边、旧模板、停用 Provider、跨 Workspace，以及模板后来发布新版本
后已发布 Workflow Version 仍保留原 `versionId`。

### 5.2 GREEN

- `type=evaluation` 必须恰好一条入边。
- 校验 `rubricRef.rubricId/versionId/version/name`。
- 校验同 Workspace、active Rubric、LLM、完整维度契约与未停用 Provider。
- 依赖现有节点 `data` 快照保存机制，不创建第二套图序列化或新表。

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_workflow_lifecycle_api.py -q
```

## Task 6：Runtime 真正执行 Evaluation Node

Files：

- Modify: `apps/api/tests/test_execution_api.py`
- Modify: `apps/api/app/execution.py`
- Modify: `apps/api/app/main.py`

### 6.1 RED

新增：

- `test_workflow_evaluation_node_persists_structured_result_and_usage`
- `test_low_evaluation_score_completes_without_implicit_human_review`
- `test_evaluation_failure_stops_downstream_without_success_record_or_artifact`
- `test_workflow_evaluation_uses_frozen_rubric_version`

断言 Agent -> Evaluation -> End 生成独立 Evaluation NodeRun 和 Evaluation Record；subject 指向
上游 NodeRun；输出包含完整结构化结果；NodeRun 保存 model、Token、cost、attempts 和 score；
上游 Artifact 不被替换。低分节点成功且继续执行，Judge 失败则停止后继节点，不创建成功记录或
成功 Artifact。

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_execution_api.py -k "evaluation_node or low_evaluation_score or evaluation_failure or frozen_rubric" -q
```

预期：当前 evaluation 节点透传输入而失败。

### 6.2 GREEN

- `ExecutionService` 注入同一个 `EvaluationService`。
- evaluation 分支先创建运行中 NodeRun，再执行服务。
- 成功时在同一事务保存 Evaluation Record、NodeRun 结构化输出和用量。
- 失败时保存脱敏错误与累计用量，并停止后继节点。
- `passed=false` 保持成功节点；`finish_run` 排除 evaluation 低分触发现有隐式 Human Review。

重跑聚焦测试与既有 Agent/Human/恢复流程测试。

## Task 7：工作流编排器的评估节点

Files：

- Modify: `src/types.ts`
- Modify: `src/components/WorkflowNode.tsx`
- Modify: `src/components/WorkflowNode.test.tsx`
- Modify: `src/pages/Workflows.tsx`
- Modify: `src/pages/Workflows.test.tsx`
- Modify: `src/index.css`

### 7.1 节点外观 RED/GREEN

先测试 `kind=evaluation` 有独立图标及输入/输出连接点；再扩展节点类型和图标映射，保留 Gate
历史兼容。

### 7.2 节点面板 RED/GREEN

先断言面板出现“评估”且不再提供“质量门禁”新增入口；点击后节点提示选择模板。再做最小面板
改动，不删除旧 Gate 加载/渲染代码。

### 7.3 模板选择 RED/GREEN

测试并实现：

- 独立加载 Rubric、Rubric Version 与 Provider，失败不阻断工作流本身。
- 只列出 active Rubric、未停用 Provider、LLM、非空模型、完整 `id/criteria` 的发布版本。
- Inspector 展示维度、通过分、Provider 与模型，不能在节点内覆盖模型。
- 无兼容模板时链接到评估中心；加载失败与真正空列表采用不同提示。
- 选择时仅写入已确认的 `rubricRef`；保存/重载后保持版本。
- 已保存但后来不可用的引用保留并提示，不静默清空或漂移。

```powershell
npm test -- --run src/components/WorkflowNode.test.tsx src/pages/Workflows.test.tsx
```

## Task 8：运行详情展示逐维度理由

Files：

- Modify: `src/types.ts`
- Modify: `src/pages/Runs.tsx`
- Modify: `src/pages/Runs.test.tsx`
- Modify: `src/index.css`

### 8.1 RED

使用 Evaluation Node fixture 断言：

- 节点卡显示整数总分与“评估通过/评估未通过”。
- 详情显示模板版本、Provider、实际模型和总评理由。
- 每维显示名称、分数、权重、两位小数加权分和理由。
- Timeline 不直接把结构化 JSON 当用户文案。
- `passed=false` 仍使用执行成功样式。
- 无效 JSON/缺字段不崩溃，显示“评估结果格式无效”并保留诊断摘要。

```powershell
npm test -- --run src/pages/Runs.test.tsx
```

预期：现有页面只显示通用分数或原始输出而失败。

### 8.2 GREEN

增加严格 `EvaluationNodeResult` 类型和局部安全解析器，仅处理 evaluation 节点；新增评估结果详情
区及最小样式，不改变其他节点的输出展示。

## Task 9：V1 Lite 种子与端到端验收

Files：

- Modify: `apps/api/tests/test_v1_lite_seed.py`
- Modify: `apps/api/tests/test_v1_lite_e2e_acceptance.py`
- Modify: `apps/api/app/v1_lite_seed.py`
- Add: `e2e/evaluation-workflow.spec.ts`（仅在现有 E2E 基础设施适合复用时）

先让种子测试断言 evaluation 节点引用真实已发布模板版本，并让验收测试断言运行自身生成
Evaluation Record，而非运行结束后手工调用 evaluate API。随后按现有 Provider 资产创建兼容模板
与 `rubricRef`；没有可用 Provider 时明确失败，不回退到隐式全局模型。

浏览器验证路径：创建/编辑并发布模板 -> 工作流添加评估节点 -> 选择固定版本 -> 保存与发布 ->
运行 -> 查看总评和全部维度理由。额外确认低分仍继续、无模板空态明确、控制台无新错误。

## Task 10：完整验证、对抗式审查与交付记录

### 10.1 聚焦后端回归

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_migrations.py apps/api/tests/test_model_gateway.py apps/api/tests/test_judge_gateway.py apps/api/tests/test_evaluation_service.py apps/api/tests/test_evaluations_api.py apps/api/tests/test_workflow_lifecycle_api.py apps/api/tests/test_execution_api.py apps/api/tests/test_v1_lite_seed.py apps/api/tests/test_v1_lite_e2e_acceptance.py -q
```

### 10.2 全量验证

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q
npm test -- --run
npm run lint
npm run build
npm run deploy:check
git diff --check
```

以 `package.json` 的实际脚本名为准；若仓库脚本是 `check:deployment` 而非 `deploy:check`，使用现有
脚本，不新增别名。

### 10.3 对抗式审查

逐项检查：跨 Workspace 是否统一拒绝且不泄漏存在性；Provider 停用和 Secret 缺失是否失败；
失败是否误留成功记录；重试用量是否丢失；低分是否误触发人工审核；模板版本是否漂移；旧 Gate、
direct evaluation、Regression/Remediation 是否回归；文档是否把单次模型判断夸大为已校准质量。

### 10.4 更新长期事实

全部证据通过后更新：

- `docs/CURRENT_IMPLEMENTATION.md`
- `docs/project-management/project-overview.md`
- Issue 01 验收记录
- `.scratch/evaluation-template-node/issues/01-workflow-evaluation-node.md`
- `.scratch/evaluation-template-node/status.md`

只报告“单上游、单模板版本、单 Provider/模型的可解释评分闭环”。Issue 02 在此时仅解除阻塞，
不宣称评估中心页面已经收口。
