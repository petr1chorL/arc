# V0.12D 验收说明：LLM-as-a-Judge 第一切片

> 日期：2026-06-27

## 本版完成内容

V0.12D 第一切片把评估中心从“只有确定性评分器”推进到“Rubric 可声明 LLM Judge，并通过可注入 Judge Gateway 执行评分”。

- Rubric 新增 `judgeType`，支持 `deterministic` 和 `llm`。
- Rubric 新增 `judgeModel`，用于记录期望的 Judge 模型。
- Evaluation 记录新增 `evaluatorType`、`evaluatorModel` 和 `evaluatorInput`。
- `judgeType=llm` 的 Rubric 在直接评估时调用可注入 `JudgeGateway`。
- LLM Judge 结果会保存维度分、总分、状态、理由、模型和可复现输入快照。
- 默认 `ModelJudgeGateway` 会通过现有 OpenAI-compatible `ModelGateway` 请求 Judge 模型，并解析 JSON 评分结果。
- `ModelJudgeGateway` 会校验 Judge 返回的维度分结构，并在解析失败时重试。
- 前端 Rubric 配置弹窗支持选择确定性评分器或 LLM Judge，并保存 Judge 模型。
- 旧 SQLite 表会自动补 Rubric 与 Evaluation 新字段。

## 没有完成的内容

- 更严格的 Judge Prompt 版本管理。
- LLM Judge 的批量校准、一致性评估和成本统计。

## 自动化验收

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_evaluations_api.py::test_llm_judge_rubric_evaluation_records_model_and_input_snapshot -q
```

预期结果：

- 1 项通过。
- 覆盖 LLM Judge 直评、维度分落库、模型记录和 evaluator 输入快照。

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_evaluations_api.py -q
```

预期结果：

- 14 项通过。
- 覆盖评估中心 Rubric、直评、回归任务、修复任务和 LLM Judge 第一切片。

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_judge_gateway.py apps/api/tests/test_evaluations_api.py apps/api/tests/test_model_gateway.py -q
```

预期结果：

- 18 项通过。
- 覆盖 ModelJudgeGateway JSON 解析、解析失败重试、维度分 schema 校验、评估中心和 OpenAI-compatible ModelGateway 回归。

```powershell
npm test -- --run src/pages/Evaluations.test.tsx
```

预期结果：

- 14 项通过。
- 覆盖 Rubric 配置弹窗创建 LLM Judge 量规并提交 `judgeType` / `judgeModel`。

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q
npm test -- --run
npm run lint
npm run build
```

预期结果：

- 后端全量 170 项通过。
- 前端 27 个测试文件、97 项测试通过。
- Oxlint 通过。
- TypeScript 编译与 Vite 生产构建通过。
