# V0.23C 工作流节点删除保护验收

V0.23C 补齐工作流编排中心的节点删除保护。用户删除节点前可以看到关联连线影响，并需要二次确认。

## 范围

- 节点配置面板展示当前节点入边、出边和影响连线总数。
- 删除节点进入确认态，不立即改变画布。
- 取消删除保持节点、连线和当前选择不变。
- 确认删除后移除节点及其关联连线。
- 保存草稿时请求体反映删除后的图结构。

## 验收清单

- [x] 选中已连接节点后可看到删除影响摘要。
- [x] 点击删除后进入确认态。
- [x] 取消删除后画布不变。
- [x] 确认删除后节点被移除。
- [x] 确认删除后关联连线被移除。
- [x] 保存草稿请求体包含删除后的节点和连线。
- [x] 不新增后端接口，不改变工作流草稿契约。

## 自动化验证

- RED：`npx vitest run src/pages/Workflows.test.tsx --reporter verbose --pool=forks --fileParallelism=false --testTimeout 15000` 首次失败，原因是节点配置面板没有“删除影响”摘要。
- GREEN：`npx vitest run src/pages/Workflows.test.tsx --reporter verbose --pool=forks --fileParallelism=false --testTimeout 15000` 通过，1 个测试文件、11 个测试。
- 前端拆分回归：
  - 非 pages：`npx vitest run src/api src/components src/auth src/domain src/App.test.tsx --pool=forks --fileParallelism=false --testTimeout 15000 --reporter verbose` 通过，20 个测试文件、68 个测试。
  - 轻页面组：`npx vitest run src/pages/ActivateInvitation.test.tsx src/pages/AgentDetail.test.tsx src/pages/Agents.test.tsx src/pages/AssetLibrary.test.tsx src/pages/AuditLog.test.tsx src/pages/Login.test.tsx src/pages/Members.test.tsx src/pages/ModelProviders.test.tsx --pool=forks --fileParallelism=false --testTimeout 15000 --reporter verbose` 通过，8 个测试文件、28 个测试。
  - Evaluations + Reviews：`npx vitest run src/pages/Evaluations.test.tsx src/pages/Reviews.test.tsx --pool=forks --fileParallelism=false --testTimeout 15000 --reporter verbose` 通过，2 个测试文件、32 个测试。
  - Observability：`npx vitest run src/pages/Observability.test.tsx --pool=forks --fileParallelism=false --testTimeout 15000 --reporter verbose` 通过，1 个测试文件、11 个测试。
  - Runs：`npx vitest run src/pages/Runs.test.tsx --pool=forks --fileParallelism=false --testTimeout 15000 --reporter verbose` 通过，1 个测试文件、12 个测试。
  - Workflows：`npx vitest run src/pages/Workflows.test.tsx --pool=forks --fileParallelism=false --testTimeout 15000 --reporter verbose` 通过，1 个测试文件、11 个测试。
- 后端：`apps\api\.venv\Scripts\python.exe -m pytest apps/api/tests -q -ra` 通过。
- 质量门：`npm run lint` 通过。
- 构建：`npm run build` 通过，仅保留 Vite chunk size 警告。

说明：前端全量和 `src/pages` 聚合运行曾在本机 Vitest worker 层超时，无失败用例输出；已按文件组拆分覆盖同一测试范围，全部通过。

## 浏览器验收

- 本地创建仅用于验收的 Workspace 管理员账号，不写入代码和文档密钥。
- Playwright 登录 `http://127.0.0.1:4173`，进入 `/w/ai-capability-center/workflows`。
- 新建默认工作流，选中中间节点后，删除影响摘要显示 2 条关联连线。
- 点击删除后节点不会立即移除；点击取消后节点和连线保持不变。
- 再次点击删除并确认后，节点数从 3 降到 2，连线数从 2 降到 0。
- 截图证据：`.scratch/v0.23c-workflow-delete-guard/browser-delete-guard-acceptance.png`。

## 非目标

- 不实现撤销或重做。
- 不实现多选删除。
- 不实现框选或分组。
- 不新增后端删除接口。
