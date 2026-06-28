# V0.24C 验收记录：运行时连线映射骨架

## 范围

V0.24C 将 V0.24B 的连线字段映射接入工作流执行链路：

- 入边有 `edge.data.mappings` 时，下游节点输入由上游 JSON 输出映射生成。
- 支持 `$` 和 `$.a.b` 简单对象路径。
- 下游 `NodeRun.input` 记录映射后的 JSON 文本。
- 没有映射、上游不是 JSON 或路径缺失时，回退到旧的输入拼接行为。

本版本不改变前端运行表单，不实现数组路径、完整 JSONPath、表达式或 Data Object 资产。

## 自动化验收

已通过：

```powershell
apps\api\.venv\Scripts\python.exe -m pytest apps/api/tests/test_execution_api.py::test_workflow_edge_mapping_builds_downstream_agent_input -q -ra
apps\api\.venv\Scripts\python.exe -m pytest apps/api/tests/test_execution_api.py::test_workflow_edge_mapping_builds_downstream_agent_input apps/api/tests/test_execution_api.py::test_workflow_edge_mapping_falls_back_when_source_is_not_mappable apps/api/tests/test_execution_api.py::test_workflow_without_edge_mapping_keeps_original_agent_input -q -ra
apps\api\.venv\Scripts\python.exe -m pytest apps/api/tests/test_execution_api.py apps/api/tests/test_human_workflow_execution.py apps/api/tests/test_execution_worker.py -q -ra
npm run lint
npm run build
```

关键结果：

- V0.24C 三条聚焦执行测试：3 passed。
- 执行、人工工作流、worker 回归测试：42 passed。
- `npm run lint` 通过。
- `npm run build` 通过，仍保留既有 Vite chunk-size warning。

## 接口验收

已通过后端 API 路径验证：

1. 创建并发布包含 `start -> agent` 映射的工作流：
   ```json
   {
     "sourcePath": "$.asin",
     "targetPath": "$.input.asin"
   }
   ```
2. 使用运行输入：
   ```json
   {"asin":"B0TEST","market":"US","ignored":"value"}
   ```
3. 断言 Agent Gateway 收到：
   ```json
   {"input":{"asin":"B0TEST","market":"US"}}
   ```
4. 断言 Agent 节点的 `NodeRun.input` 同样记录映射后的 JSON。
5. 断言没有映射、源输入非 JSON 或路径缺失时继续使用旧输入。

## 验收结论

V0.24C 已让连线字段映射进入实际执行链路。后续可以继续建设完整 JSONPath、Schema 字段选择器、Data Object 资产和运行输入表单。
