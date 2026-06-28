# V0.23D 工作流连线编辑验收

V0.23D 补齐工作流编排中心的连线选中和删除能力。用户可以单独处理错误连线，而不需要删除节点。

## 范围

- 点击连线后打开连线配置面板。
- 连线配置面板展示上游节点、下游节点和连线 ID。
- 删除连线不会删除任何节点。
- 保存草稿时请求体反映删除后的边数组。

## 验收清单

- [x] 点击连线后可看到连线配置面板。
- [x] 面板展示上游节点、下游节点和连线 ID。
- [x] 选中连线时不会同时显示节点配置面板。
- [x] 删除连线后边数减少。
- [x] 删除连线后节点保持不变。
- [x] 保存草稿请求体包含删除后的边数组。
- [x] 不新增后端接口，不改变工作流草稿契约。

## 自动化验证

- RED：`npx vitest run src/pages/Workflows.test.tsx --reporter verbose --pool=forks --fileParallelism=false --testTimeout 15000` 首次失败，原因是点击连线后找不到“连线配置”面板。
- GREEN：`npx vitest run src/pages/Workflows.test.tsx --reporter verbose --pool=forks --fileParallelism=false --testTimeout 15000` 通过，1 个测试文件、12 个测试。
- 前端拆分回归：
  - 非 pages：`npx vitest run src/api src/components src/auth src/domain src/App.test.tsx --pool=forks --fileParallelism=false --testTimeout 15000 --reporter verbose` 通过，20 个测试文件、68 个测试。
  - 轻页面组：`npx vitest run src/pages/ActivateInvitation.test.tsx src/pages/AgentDetail.test.tsx src/pages/Agents.test.tsx src/pages/AssetLibrary.test.tsx src/pages/AuditLog.test.tsx src/pages/Login.test.tsx src/pages/Members.test.tsx src/pages/ModelProviders.test.tsx --pool=forks --fileParallelism=false --testTimeout 15000 --reporter verbose` 通过，8 个测试文件、28 个测试。
  - Evaluations + Reviews：`npx vitest run src/pages/Evaluations.test.tsx src/pages/Reviews.test.tsx --pool=forks --fileParallelism=false --testTimeout 15000 --reporter verbose` 通过，2 个测试文件、32 个测试。
  - Observability：`npx vitest run src/pages/Observability.test.tsx --pool=forks --fileParallelism=false --testTimeout 15000 --reporter verbose` 通过，1 个测试文件、11 个测试。
  - Runs：`npx vitest run src/pages/Runs.test.tsx --pool=forks --fileParallelism=false --testTimeout 15000 --reporter verbose` 通过，1 个测试文件、12 个测试。
- 后端：`apps\api\.venv\Scripts\python.exe -m pytest apps/api/tests -q -ra` 通过。
- 质量门：`npm run lint` 通过。
- 构建：`npm run build` 通过，仅保留 Vite chunk size 警告。

## 浏览器验收

- 本地创建仅用于验收的 Workspace 管理员账号，不写入代码和文档密钥。
- Playwright 登录 `http://127.0.0.1:4173`，进入 `/w/ai-capability-center/workflows`。
- 新建默认工作流，点击第一条 React Flow 连线后，右侧出现连线配置面板。
- 点击“删除连线”后，节点数从 3 保持为 3，连线数从 2 降为 1。
- 截图证据：`.scratch/v0.23d-workflow-edge-editing/browser-edge-editing-acceptance.png`。

## 非目标

- 不实现拖拽重连。
- 不实现连线标签或条件表达式。
- 不实现多选连线或批量删除。
- 不实现撤销或重做。
