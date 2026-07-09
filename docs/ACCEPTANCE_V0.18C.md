# V0.18C 角色变更风险提示验收

## 范围

V0.18C 在成员与权限页补充角色变更前的风险提示：

- 复用 V0.18B 的 `WorkspacePermissionMatrix`，不新增后端接口。
- 当前角色与草稿角色不一致时，展示“角色变更影响”。
- 升级角色时展示新增权限。
- 降级角色时展示移除权限。
- 对 `audit.read`、`audit.export`、`member.manage`、`workspace.manage`、`asset.deactivate`、`reviewer.manage` 标记为“高风险”。
- 仅提示风险，不阻断保存，不引入审批流。

## 验收证据

- RED 前端：`npx vitest run src/pages/Members.test.tsx --reporter verbose` 首次失败，原因是页面缺少 `builder@example.com 角色变更影响`。
- GREEN 前端聚焦：`npx vitest run src/pages/Members.test.tsx --reporter verbose` 通过，1 个文件、5 项测试。
- 前端相关回归：`npx vitest run src/api/members.test.ts src/pages/Members.test.tsx --reporter verbose` 通过，2 个文件、6 项测试。
- 全量前端：`npm run test -- --run` 通过，33 个文件、131 项测试。
- `npm run lint` 通过。
- `npm run build` 通过，保留既有 Vite chunk-size warning。

## 浏览器验收

- 路由：`http://127.0.0.1:4173/w/ai-capability-center/settings/members`。
- 选择 viewer 成员 `349472077@qq.com` 升级到 `workspace_admin`，页面显示“角色变更影响”“新增权限”和多项“高风险”权限。
- 选择管理员 `admin@example.com` 降级到 `viewer`，页面显示“角色变更影响”“移除权限”和多项“高风险”权限。
- 验收过程中未点击保存按钮，因此没有提交角色变更。
- 浏览器控制台 warning/error 数量为 0。

## 非范围

- 不新增角色变更审批流。
- 不新增自定义角色。
- 不支持在权限矩阵里编辑权限。
- 不改变现有角色保存 API。

