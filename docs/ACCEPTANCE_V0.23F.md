# V0.23F 工作流撤销与重做验收

V0.23F 为工作流编排中心增加页面内撤销和重做能力。

## 范围

- 新增节点、复制节点、删除节点、删除连线和新增连线进入撤销/重做历史。
- 撤销恢复上一步画布结构，重做恢复刚撤销的编辑。
- 加载、新建、切换和保存成功后重置历史栈。
- 不新增后端接口，不改变工作流草稿契约。

## 验收清单

- [x] 初始加载后，“撤销”和“重做”不可用。
- [x] 新增节点后，“撤销”可用；撤销后节点被移除，“重做”可用。
- [x] 重做后，刚撤销的新增节点恢复。
- [x] 删除已连接节点后，撤销可恢复节点和关联连线，重做可再次删除。
- [x] 删除连线后，撤销可恢复连线，重做可再次删除。
- [x] 新建、切换或保存成功后，撤销/重做历史重置。
- [x] 不新增后端接口，不改变工作流草稿契约。

## 自动化验证

- RED：新增 `Workflows` 测试后，缺少“撤销”按钮时失败。
- GREEN：`npx vitest run src/pages/Workflows.test.tsx --reporter verbose --pool=forks --fileParallelism=false --testTimeout 15000` 通过，17 个测试通过。
- 前端回归：
  - `npx vitest run src/api src/components src/auth src/domain src/App.test.tsx --pool=forks --fileParallelism=false --testTimeout 15000 --reporter verbose` 通过，68 个测试通过。
  - `npx vitest run src/pages/ActivateInvitation.test.tsx src/pages/AgentDetail.test.tsx src/pages/Agents.test.tsx src/pages/AssetLibrary.test.tsx src/pages/AuditLog.test.tsx src/pages/Login.test.tsx src/pages/Members.test.tsx src/pages/ModelProviders.test.tsx --pool=forks --fileParallelism=false --testTimeout 15000 --reporter verbose` 通过，28 个测试通过。
  - `npx vitest run src/pages/Evaluations.test.tsx src/pages/Reviews.test.tsx --pool=forks --fileParallelism=false --testTimeout 15000 --reporter verbose` 通过，32 个测试通过。
  - `npx vitest run src/pages/Observability.test.tsx src/pages/Runs.test.tsx --pool=forks --fileParallelism=false --testTimeout 15000 --reporter verbose` 通过，23 个测试通过。
- 后端回归：`apps\api\.venv\Scripts\python.exe -m pytest apps/api/tests -q -ra` 通过，保留第三方 `StarletteDeprecationWarning`。
- 质量检查：`npm run lint` 通过。
- 构建检查：`npm run build` 通过，保留 Vite chunk size 提醒。

## 浏览器验收

- 浏览器验收通过：使用本地验收账号登录当前 worktree 的 Vite 服务，进入工作流编排页；初始“撤销/重做”禁用；新增节点后撤销可用，撤销后节点数 4 -> 3，重做后 3 -> 4；删除 Agent 节点后节点数 3 -> 2、连线数 2 -> 0，撤销恢复到 3 节点 2 连线，重做再次回到 2 节点 0 连线。
- 验收脚本记录到 2 条登录前 `/api/auth/session` 的 401，它们来自未登录会话探测，不是 V0.23F 行为错误。
- 截图证据：`.scratch\v0.23f-workflow-undo-redo\browser-undo-redo-acceptance.png`。

## 非目标

- 不实现键盘快捷键。
- 不实现拖拽位置变化撤销。
- 不实现工作流名称撤销。
- 不实现跨路由或跨工作流持久化历史。
