# V0.26B 验收记录：Artifact 目录查询 API

## 范围

- 新增 `GET /api/workspaces/{workspaceId}/artifacts`。
- 返回当前 Workspace 的 ArtifactVersion 目录，包含 Artifact、Run、来源 NodeRun、内容、得分和 Data Object 契约信息。
- 支持 `dataObjectDefinitionId` 查询参数过滤。
- 使用 `run.read` 权限保护该查询入口。

## 验收结果

- RED：新增测试后，请求 `/artifacts` 返回 `404`。
- GREEN：新增 Artifact 目录 API 后，绑定输出 Data Object 的工作流产物可以被查询到。
- 过滤验证：传入匹配的 `dataObjectDefinitionId` 返回 1 条记录；传入不存在的 Definition ID 返回空数组。
- 隔离验证：另一个 Workspace 查询不到当前 Workspace 的 Artifact。
- 执行 API 回归测试：`39 passed`。
- Python 编译检查通过。
- `npm run lint`：通过。
- `npm run build`：通过；保留既有 Vite 大 chunk 警告。

## 验证命令

```powershell
cd apps/api
.\.venv\Scripts\python.exe -m pytest tests\test_execution_api.py -k artifact_catalog_lists_versions_with_data_object_filter -q
.\.venv\Scripts\python.exe -m pytest tests\test_execution_api.py -q
.\.venv\Scripts\python.exe -m py_compile app\main.py app\schemas.py
cd ..\..
npm run lint
npm run build
```

## 覆盖场景

- Artifact 目录返回 `artifactId`、`artifactVersionId`、`runId`、`sourceNodeRunId`、`content` 和 `score`。
- Artifact 目录返回 Data Object Definition ID、Data Object Version ID 和 Data Object Snapshot。
- 可按 Data Object Definition ID 过滤。
- Workspace 隔离生效。

## 尚未覆盖

- 不提供前端 Artifact 实例页。
- 不支持分页游标、全文搜索、排序配置或批量导出。
- 不返回完整 Run / NodeRun 详情。
- 不新增独立 `artifact.read` 权限，暂沿用 `run.read`。
