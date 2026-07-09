# V0.25F 验收记录：Workflow 发布冻结 Data Object 版本快照

## 范围

- 工作流发布时会读取节点 `inputDataObjectRef` 和 `outputDataObjectRef` 中声明的 Data Object 版本。
- WorkflowVersion 的 `snapshot` 会把 Data Object 引用补齐为不可变版本引用，包含 `versionId` 和当时发布的 `snapshot`。
- Data Object Definition 后续编辑、再次发布为新版本后，旧 WorkflowVersion 仍保留原始 Data Object Version 快照。
- 工作流校验会确认节点引用的 Data Object Version 在当前 Workspace 内真实存在。

## 验收结果

- RED：新增测试后，发布出的 WorkflowVersion 只保留版本字符串，没有 `versionId`，测试因 `KeyError: 'versionId'` 失败。
- GREEN：发布快照补齐 Data Object Version 信息后，旧版本 `v1.0.0` 和原始 Schema 可以被固定在 WorkflowVersion 中。
- 工作流生命周期 API 回归测试：`7 passed`。
- Data Object API 回归测试：`6 passed`。
- Python 编译检查通过。
- `npm run lint`：通过。
- `npm run build`：通过；保留既有 Vite 大 chunk 警告。

## 验证命令

```powershell
cd apps/api
.\.venv\Scripts\python.exe -m pytest tests\test_workflow_lifecycle_api.py -k freezes_data_object_version_snapshots -q
.\.venv\Scripts\python.exe -m pytest tests\test_workflow_lifecycle_api.py -q
.\.venv\Scripts\python.exe -m pytest tests\test_data_object_definitions_api.py -q
.\.venv\Scripts\python.exe -m py_compile app\domain.py app\main.py
cd ..\..
npm run lint
npm run build
```

## 覆盖场景

- 节点绑定 Data Object `v1.0.0`。
- Data Object Definition 随后被编辑并发布为 `v1.1.0`。
- 工作流发布仍冻结节点引用的 `v1.0.0`。
- WorkflowVersion 快照中的节点引用包含 `versionId` 和原始 Data Object Version `snapshot`。

## 尚未覆盖

- 不提供前端 Data Object Version 历史选择器。
- 不在运行时校验 Artifact 内容是否符合 Data Object Schema。
- 不做 Data Object 版本兼容性分析或变更影响面扫描。
- 不提供 WorkflowVersion 与 Data ObjectVersion 的可视化依赖图。
