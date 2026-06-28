# V0.25E 验收记录：Data Object 节点绑定发布前校验

## 范围

- 工作流 `/validate` 会检查节点上的 `inputDataObjectRef` 和 `outputDataObjectRef`。
- 绑定的 Data Object Definition 必须存在于当前 Workspace。
- 绑定的 Data Object Definition 必须已发布。
- 工作流 `/publish` 复用同一校验；校验失败时返回 `422`，不创建 WorkflowVersion。

## 验收结果

- RED：新增后端测试后，绑定未发布 Data Object 的工作流仍然 `valid=True`。
- GREEN：`validate_workflow` 接入 Data Object Definition 查询后，未发布和缺失引用都能返回错误。
- 工作流生命周期 API 回归测试：`6 passed`。
- Data Object API 回归测试：`6 passed`。
- Python 编译检查通过。
- `npm run lint`：通过。
- `npm run build`：通过；保留既有 Vite 大 chunk 警告。

## 验证命令

```powershell
cd apps/api
.\.venv\Scripts\python.exe -m pytest tests\test_workflow_lifecycle_api.py -k data_object_refs -q
.\.venv\Scripts\python.exe -m pytest tests\test_workflow_lifecycle_api.py -q
.\.venv\Scripts\python.exe -m pytest tests\test_data_object_definitions_api.py -q
.\.venv\Scripts\python.exe -m py_compile app\domain.py app\main.py
cd ..\..
npm run lint
npm run build
```

## 覆盖场景

- 节点输入 Data Object 绑定到已发布 Definition 时通过校验。
- 节点输出 Data Object 绑定到未发布 Definition 时，`/validate` 返回无效。
- 同一工作流发布时返回 `422`。
- 节点输出 Data Object 绑定到缺失 Definition ID 时，`/validate` 返回不存在错误。

## 尚未覆盖

- 不校验节点输入/输出实际 Artifact 是否符合 Schema。
- 不比较节点 ref 中的版本字符串和 Definition 当前版本是否一致。
- 不提供 Data Object Version 固定选择。
- 不做跨节点字段级兼容性分析。
