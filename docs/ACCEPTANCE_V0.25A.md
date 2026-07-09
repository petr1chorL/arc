# V0.25A 验收记录：Data Object Definition 后端骨架

## 范围

- 新增 Workspace 级 Data Object Definition 后端模型。
- 新增 Data Object Version 不可变版本模型。
- 新增 API：
  - `GET /api/workspaces/{workspaceId}/data-objects`
  - `POST /api/workspaces/{workspaceId}/data-objects`
  - `POST /api/workspaces/{workspaceId}/data-objects/{definitionId}/publish`
- 创建时保存名称、描述、JSON Schema、状态、版本、创建人和时间。
- 发布时冻结 Definition 快照，并更新主记录最新版本号。
- 新表纳入迁移 Workspace 表清单。

## 验收结果

- RED：新增测试后，因 `DataObjectDefinitionRecord` 不存在而收集失败，证明功能缺失。
- GREEN：实现模型、Schema、路由和迁移表清单后，Data Object API 测试通过。
- 迁移测试：`test_migrations.py` 与 `test_v07a_migrations.py` 通过。
- 语法检查：`python -m py_compile app/models.py app/schemas.py app/main.py app/migrations.py` 通过。
- `npm run lint`：通过。
- `npm run build`：通过；仍保留既有 Vite 大 chunk 警告。

## 验证命令

```powershell
.\.venv\Scripts\python.exe -m py_compile app\models.py app\schemas.py app\main.py app\migrations.py
.\.venv\Scripts\python.exe -m pytest tests/test_data_object_definitions_api.py -q
.\.venv\Scripts\python.exe -m pytest tests/test_migrations.py tests/test_v07a_migrations.py -q
npm run lint
npm run build
```

## 覆盖场景

- 创建并列出 Data Object Definition。
- 同一 Workspace 内重复名称返回 `409`。
- 不同 Workspace 数据隔离。
- 发布返回 `v1.0.0` Data Object Version。
- 后续修改 Definition 不会改变旧版本快照，再次发布生成 `v1.1.0`。

## 尚未覆盖

- 不提供前端页面。
- 不接入工作流节点输入输出绑定。
- 不把运行 Artifact 改为 Data Object 实例。
- 不实现停用、影响面、审计面板或迁移工具。
- 不实现完整 JSON Schema 语义校验。
