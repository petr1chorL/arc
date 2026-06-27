# V0.12D 验收说明：LLM-as-a-Judge 第一切片

> 日期：2026-06-27

## 本版完成内容

V0.12D 第一切片把评估中心从“只有确定性评分器”推进到“Rubric 可声明 LLM Judge，并通过可注入 Judge Gateway 执行评分”。

- Rubric 新增 `judgeType`，支持 `deterministic` 和 `llm`。
- Rubric 新增 `judgeModel`，用于记录期望的 Judge 模型。
- Evaluation 记录新增 `evaluatorType`、`evaluatorModel` 和 `evaluatorInput`。
- `judgeType=llm` 的 Rubric 在直接评估时调用可注入 `JudgeGateway`。
- LLM Judge 结果会保存维度分、总分、状态、理由、模型和可复现输入快照。
- 旧 SQLite 表会自动补 Rubric 与 Evaluation 新字段。

## 没有完成的内容

- 真实 LLM Judge Prompt 模板、JSON 解析和重试。
- Judge Gateway 与现有 OpenAI-compatible ModelGateway 的正式接入。
- LLM Judge 的批量校准、一致性评估和成本统计。
- 前端 Rubric 配置弹窗中的 Judge 类型选择控件。

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
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q
npm test -- --run
npm run lint
npm run build
```

预期结果：

- 后端全量 167 项通过。
- 前端 27 个测试文件、96 项测试通过。
- Oxlint 通过。
- TypeScript 编译与 Vite 生产构建通过。
