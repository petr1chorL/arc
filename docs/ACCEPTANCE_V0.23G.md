# V0.23G 工作流编辑快捷键验收

V0.23G 为工作流编排中心增加页面级键盘快捷键。

## 范围

- `Ctrl/Cmd+Z` 撤销画布编辑。
- `Ctrl/Cmd+Y` 和 `Ctrl/Cmd+Shift+Z` 重做画布编辑。
- `Delete` / `Backspace` 删除选中连线。
- `Delete` / `Backspace` 对选中节点先弹出确认提示，确认后删除节点及关联连线。
- 输入控件中不触发画布快捷键。

## 验收清单

- [x] 新增节点后，按 `Ctrl/Cmd+Z` 撤销该节点。
- [x] 撤销后，按 `Ctrl/Cmd+Y` 或 `Ctrl/Cmd+Shift+Z` 重做该节点。
- [x] 在工作流名称、节点配置输入框或下拉框中按快捷键，不会触发画布撤销、重做或删除。
- [x] 选中连线后按 `Delete` 或 `Backspace` 删除连线，节点保持不变。
- [x] 选中节点后按 `Delete` 或 `Backspace` 先出现确认提示；取消不删除，确认后删除节点和关联连线。
- [x] 不新增后端接口，不改变工作流草稿契约。

## 自动化验证

- RED：新增快捷键测试后，`Ctrl+Z` 未撤销新增节点，符合预期失败。
- RED：新增 `Delete` 删除连线、节点删除确认测试后，页面未响应键盘删除，符合预期失败。
- GREEN：`npx vitest run src/pages/Workflows.test.tsx --reporter verbose --pool=forks --fileParallelism=false --testTimeout 15000`
  - 结果：`21 passed`
- 回归：`npx vitest run src/api src/components src/auth src/domain src/App.test.tsx --pool=forks --fileParallelism=false --testTimeout 15000 --reporter verbose`
  - 结果：`68 passed`
- 回归：`npx vitest run src/pages/ActivateInvitation.test.tsx src/pages/AgentDetail.test.tsx src/pages/Agents.test.tsx src/pages/AssetLibrary.test.tsx src/pages/AuditLog.test.tsx src/pages/Login.test.tsx src/pages/Members.test.tsx src/pages/ModelProviders.test.tsx --pool=forks --fileParallelism=false --testTimeout 15000 --reporter verbose`
  - 结果：`28 passed`
- 回归：`npx vitest run src/pages/Evaluations.test.tsx src/pages/Reviews.test.tsx --pool=forks --fileParallelism=false --testTimeout 15000 --reporter verbose`
  - 结果：`32 passed`
- 回归：`npx vitest run src/pages/Observability.test.tsx src/pages/Runs.test.tsx --pool=forks --fileParallelism=false --testTimeout 15000 --reporter verbose`
  - 结果：`23 passed`
- 后端：全量 `apps\api\.venv\Scripts\python.exe -m pytest apps/api/tests -q -ra` 在当前 shell 超过 3 分钟被截断；改为按 `apps/api/tests/test_*.py` 逐文件执行，全部通过。
- `npm run lint`
  - 结果：通过，无 warning。
- `npm run build`
  - 结果：通过；Vite 保留既有 chunk size warning。

## 浏览器验收

- 浏览器：系统 Chrome，`http://127.0.0.1:4173/w/ai-capability-center/workflows`。
- 使用一次性本地验收账号登录；密码只在脚本内存中生成和使用，未输出、未写入仓库。
- 验收动作：
  - 新建工作流默认显示 3 个节点、2 条连线。
  - 点击添加“手动触发”节点后，`Ctrl+Z` 回到 3 个节点，`Ctrl+Y` 回到 4 个节点，再次 `Ctrl+Z` 回到 3 个节点。
  - 选中第一条连线后按 `Delete`，连线从 2 条变 1 条；`Ctrl+Z` 后恢复 2 条。
  - 选中 Agent 节点后按 `Delete`，出现“删除选中节点？”确认框，并展示“将同时移除 2 条关联连线。”。
  - 点击“取消删除”后画布不变；再次删除并确认后，节点变 2 个、连线变 0 条。
- 截图证据：`.scratch/v0.23g-workflow-keyboard-shortcuts/browser-keyboard-shortcuts-acceptance.png`。

## 非目标

- 不实现快捷键自定义。
- 不实现命令面板。
- 不实现多选删除。
- 不实现拖拽位置变化撤销。
- 不实现跨路由快捷键。
