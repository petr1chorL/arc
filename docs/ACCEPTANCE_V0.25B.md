# V0.25B 验收记录：Data Object Definition 草稿编辑

## 范围

- 新增 `PATCH /api/workspaces/{workspaceId}/data-objects/{definitionId}`。
- 支持更新 Data Object Definition 的名称、描述和 JSON Schema。
- 重命名时保持同 Workspace 名称唯一。
- 更新后刷新 `updatedAt`。
- 已发布 Data Object Version 快照保持不可变，再次发布生成新版本。

## 验收结果

- RED：新增 PATCH 测试后，接口返回 `404 Not Found`。
- GREEN：实现更新 schema 与 PATCH 路由后，聚焦测试通过。
- 完整 Data Object API 测试：`6 passed`。
- 语法检查：`python -m py_compile app/schemas.py app/main.py` 通过。
- `npm run lint`：通过。
- `npm run build`：通过；仍保留既有 Vite 大 chunk 警告。

## 验证命令

```powershell
.\.venv\Scripts\python.exe -m py_compile app\schemas.py app\main.py
.\.venv\Scripts\python.exe -m pytest tests/test_data_object_definitions_api.py -k "updated or duplicate_name" -q
.\.venv\Scripts\python.exe -m pytest tests/test_data_object_definitions_api.py -q
npm run lint
npm run build
```

## 覆盖场景

- 更新 Definition 名称、描述和 Schema。
- 重命名为同 Workspace 已有名称时返回 `409`。
- 更新后再次发布生成 `v1.1.0`。
- 旧版本快照保持原名称和原 Schema，新版本快照反映更新后的 Definition。

## 尚未覆盖

- 不提供前端页面。
- 不支持停用、删除或归档。
- 不做影响面分析。
- 不绑定工作流节点或运行 Artifact。
