# V0.18B 权限矩阵可视化验收

## 范围

V0.18B 在成员与权限页补充平台角色权限矩阵：

- 后端新增 `GET /api/workspaces/{workspaceId}/permissions/matrix`。
- 权限矩阵由后端 `ROLE_LEVEL` 和 `CAPABILITY_MIN_ROLE` 推导生成。
- 接口使用 `member.manage` 权限控制，viewer 读取返回 403。
- 前端 `src/api/members.ts` 新增 `getWorkspacePermissionMatrix`。
- 成员与权限页展示角色、能力、最低角色和每个角色是否具备该能力。
- 页面展示 Reviewer 是人工任务处理业务资格，不等于平台角色。

## 验收证据

- RED 后端：`apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_workspace_access_api.py -q -k "permission_matrix"` 首次失败，两个新场景均因 `/permissions/matrix` 返回 404。
- GREEN 后端聚焦：`apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_workspace_access_api.py -q -k "permission_matrix"` 通过，2 项测试。
- 后端 workspace 回归：`apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_workspace_access_api.py -q` 通过，18 项测试。
- 后端全量：`apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q` 通过。
- RED 前端：`npx vitest run src/api/members.test.ts src/pages/Members.test.tsx --reporter verbose` 首次失败，原因是页面没有 `平台角色权限矩阵`。
- GREEN 前端聚焦：`npx vitest run src/api/members.test.ts src/pages/Members.test.tsx --reporter verbose` 通过，2 个文件、5 项测试。
- 全量前端：`npm run test -- --run` 通过，33 个文件、130 项测试。
- `npm run lint` 通过。
- `npm run build` 通过，保留既有 Vite chunk-size warning。

## 浏览器验收

- 路由：`http://127.0.0.1:4173/w/ai-capability-center/settings/members`。
- 已重启 8000 API 进程，确保浏览器使用当前代码。
- 页面显示 `平台角色权限矩阵`。
- 页面显示 Reviewer 资格说明。
- 页面显示 `读取审计` 和 `workspace_admin`。
- 权限矩阵实际渲染 16 行能力。
- 页面文本不包含 `apiKey` 或 `API Key`。
- 浏览器控制台 warning/error 数量为 0。

## 非范围

- 不新增自定义角色。
- 不支持在矩阵里直接编辑权限。
- 不修改现有 RBAC 判定逻辑。
- 不做角色变更审批流。
