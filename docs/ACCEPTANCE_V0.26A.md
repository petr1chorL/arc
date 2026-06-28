# V0.26A 验收记录：最终 ArtifactVersion 记录 Data Object 契约

## 范围

- 工作流运行完成后会为最终 Artifact 创建 `ArtifactVersionRecord`。
- 如果最终产出链路中的节点绑定了 `outputDataObjectRef`，ArtifactVersion 会记录对应的 Data Object Definition ID、Data Object Version ID 和不可变快照。
- 如果工作流没有绑定输出 Data Object，ArtifactVersion 仍会创建，但 Data Object 字段保持为空。
- Agent 直接测试运行不读取 WorkflowVersion，避免被工作流快照逻辑误伤。

## 验收结果

- RED：新增测试后，最终 Artifact 只有 `ArtifactRecord`，没有 `ArtifactVersionRecord`，测试因 `artifact_version is None` 失败。
- GREEN：运行完成时创建最终 ArtifactVersion，并从 WorkflowVersion 快照读取冻结后的输出 Data Object 引用。
- 兼容性：未绑定输出 Data Object 的旧工作流仍可运行，ArtifactVersion 的 Data Object 字段为空。
- 执行 API 回归测试：`38 passed`。
- 工作流生命周期与 Data Object API 回归测试：`13 passed`。
- 迁移回归测试：`8 passed`。
- Python 编译检查通过。
- `npm run lint`：通过。
- `npm run build`：通过；保留既有 Vite 大 chunk 警告。

## 验证命令

```powershell
cd apps/api
.\.venv\Scripts\python.exe -m pytest tests\test_execution_api.py -k final_artifact_version_records_output_data_object_contract -q
.\.venv\Scripts\python.exe -m pytest tests\test_execution_api.py -k "agent_test_run_records_model_usage_and_output or workflow_run_retries_and_persists_node_timeline or final_artifact_version_records_output_data_object_contract" -q
.\.venv\Scripts\python.exe -m pytest tests\test_execution_api.py -q
.\.venv\Scripts\python.exe -m pytest tests\test_workflow_lifecycle_api.py tests\test_data_object_definitions_api.py -q
.\.venv\Scripts\python.exe -m pytest tests\test_migrations.py tests\test_v07a_migrations.py -q
.\.venv\Scripts\python.exe -m py_compile app\models.py app\migrations.py app\schemas.py app\execution.py
cd ..\..
npm run lint
npm run build
```

## 覆盖场景

- 发布绑定输出 Data Object 的工作流。
- 运行该工作流并生成最终 Artifact。
- ArtifactVersion 保存 Data Object Definition ID。
- ArtifactVersion 保存 Data Object Version ID。
- ArtifactVersion 保存 Data Object Version 的冻结快照。
- 旧工作流无绑定时仍可正常运行。
- Agent 直接测试运行仍可正常返回。

## 尚未覆盖

- 不校验 Artifact 内容是否符合 Data Object Schema。
- 不提供前端 Artifact/Data Object 实例列表。
- 不处理 Human Task 修改版本对 Data Object 契约的继承。
- 不提供 Data Object Version 到 ArtifactVersion 的影响面查询。
