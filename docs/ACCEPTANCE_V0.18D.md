# V0.18D 权限操作二次确认验收

## 范围

V0.18D 在成员与权限页为高风险权限操作增加前端二次确认：

- 保存会新增或移除高风险能力的角色变更前，弹出确认框。
- 停用 Membership 前，弹出确认框。
- 停用 User 前，弹出确认框。
- 取消确认框不会调用对应 API。
- 确认后才执行原有 API。

## 验收证据

- RED 前端：`npx vitest run src/pages/Members.test.tsx --reporter verbose` 首次失败，原因是缺少 `确认高风险权限操作` 和 `确认停用成员` 弹窗。
- GREEN 前端聚焦：`npx vitest run src/pages/Members.test.tsx --reporter verbose` 通过，1 个文件、6 项测试。
- 前端相关回归：`npx vitest run src/api/members.test.ts src/pages/Members.test.tsx --reporter verbose` 通过，2 个文件、7 项测试。
- 全量前端：`npm run test -- --run` 通过，33 个文件、132 项测试。
- `npm run lint` 通过。
- `npm run build` 通过，保留既有 Vite chunk-size warning。

## 浏览器验收

- 路由：`http://127.0.0.1:4173/w/ai-capability-center/settings/members`。
- 选择 `349472077@qq.com` 从 viewer 改为 `workspace_admin` 后点击保存，出现 `确认高风险权限操作`，展示停用资产、导出审计、读取审计、管理成员、管理 Reviewer 资格、管理 Workspace 等高风险权限；点击取消后弹窗关闭，未提交。
- 点击 `admin@example.com` 的停用成员按钮，出现 `确认停用成员`；点击取消后弹窗关闭，未提交。
- 点击 `admin@example.com` 的停用 User 按钮，出现 `确认停用 User`；点击取消后弹窗关闭，未提交。
- 浏览器控制台 warning/error 数量为 0。

## 非范围

- 不新增后端接口。
- 不实现审批流或多人确认。
- 不改变启用操作。
- 不改变现有角色、Membership、User 状态更新 API。

