# V0.23E 工作流未保存变更保护验收

V0.23E 为工作流编排中心增加未保存变更提示和页面内新建/切换保护。

## 范围

- 当前草稿与最近加载/保存版本不一致时显示未保存提示。
- 新建工作流前，如果存在未保存变更，需要确认放弃。
- 切换工作流前，如果存在未保存变更，需要确认放弃。
- 保存草稿成功后，未保存提示消失。

## 验收清单

- [x] 加载工作流后默认不显示未保存提示。
- [x] 修改画布后显示未保存提示。
- [x] 点击新建时不会直接覆盖未保存画布。
- [x] 取消放弃后保持当前画布。
- [x] 确认放弃后执行新建或切换。
- [x] 保存草稿后提示消失。
- [x] 不新增后端接口，不改变工作流草稿契约。

## 自动化验证

- RED：新增 `Workflows` 测试后，缺少未保存提示时失败。
- GREEN：`npx vitest run src/pages/Workflows.test.tsx --reporter verbose --pool=forks --fileParallelism=false --testTimeout 15000` 通过，14 个测试通过。
- 前端回归：
  - `npx vitest run src/api src/components src/auth src/domain src/App.test.tsx --pool=forks --fileParallelism=false --testTimeout 15000 --reporter verbose` 通过，68 个测试通过。
  - `npx vitest run src/pages/ActivateInvitation.test.tsx src/pages/AgentDetail.test.tsx src/pages/Agents.test.tsx src/pages/AssetLibrary.test.tsx src/pages/AuditLog.test.tsx src/pages/Login.test.tsx src/pages/Members.test.tsx src/pages/ModelProviders.test.tsx --pool=forks --fileParallelism=false --testTimeout 15000 --reporter verbose` 通过，28 个测试通过。
  - `npx vitest run src/pages/Evaluations.test.tsx src/pages/Reviews.test.tsx --pool=forks --fileParallelism=false --testTimeout 15000 --reporter verbose` 通过，32 个测试通过。
  - `npx vitest run src/pages/Observability.test.tsx --pool=forks --fileParallelism=false --testTimeout 15000 --reporter verbose` 通过，11 个测试通过。
  - `npx vitest run src/pages/Runs.test.tsx --pool=forks --fileParallelism=false --testTimeout 15000 --reporter verbose` 通过，12 个测试通过。
- 后端回归：`apps\api\.venv\Scripts\python.exe -m pytest apps/api/tests -q -ra` 通过。
- 质量检查：`npm run lint` 通过。
- 构建检查：`npm run build` 通过，保留 Vite chunk size 提醒。

## 浏览器验收

- 浏览器验收通过：加载工作流后不显示未保存提示；新增节点后显示提示；点击“新建”弹出“放弃未保存变更？”；选择“继续编辑”后节点数保持不变；再次新建并确认放弃后恢复默认 3 个节点。
- 验收过程中发现并修复一次加载即误报未保存的问题：原因是签名基线未经过与保存路径一致的节点归一化，已改为在签名计算中统一使用 `sanitizeWorkflowNodes`。
- 截图证据：`.scratch\v0.23e-workflow-unsaved-guard\browser-unsaved-guard-acceptance.png`。

## 非目标

- 不实现自动保存。
- 不实现撤销或重做。
- 不实现浏览器关闭/刷新拦截。
- 不实现跨路由离开保护。
