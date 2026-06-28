# V0.23B 工作流节点复制验收

V0.23B 补齐工作流编排中心的单节点复制能力。用户可以在节点配置面板复制当前节点，副本保留配置但不复制连线。

## 范围

- 节点配置面板新增复制节点操作。
- 复制节点保留原节点数据。
- 复制节点生成新 ID，并相对原节点偏移。
- 复制节点不复制原节点关联边。
- 保存草稿时复制节点进入原有工作流草稿请求体。

## 验收清单

- [x] 选中节点后可看到复制入口。
- [x] 点击复制后新增同类型节点。
- [x] 副本保留原节点配置。
- [x] 副本不继承连线。
- [x] 保存草稿请求体包含副本节点。
- [x] 不新增后端接口，不改变工作流草稿契约。

## 自动化验证

- RED：`npx vitest run src/pages/Workflows.test.tsx --reporter verbose --pool=forks --fileParallelism=false --testTimeout 15000` 首次失败，原因是节点配置面板没有“复制节点”入口。
- GREEN：`npx vitest run src/pages/Workflows.test.tsx --reporter verbose --pool=forks --fileParallelism=false --testTimeout 15000` 通过，覆盖复制节点、不复制连线、保存草稿请求体包含副本。
- 回归：`npx vitest run --pool=forks --fileParallelism=false --testTimeout 15000 --reporter verbose` 通过，33 个测试文件、161 个测试。
- 后端：`apps\api\.venv\Scripts\python.exe -m pytest apps/api/tests -q -ra` 通过。
- 质量门：`npm run lint` 通过。
- 构建：`npm run build` 通过，仅保留 Vite chunk size 警告。

## 浏览器验收

- 本地创建仅用于验收的 Workspace 管理员账号，不写入代码和文档密钥。
- Playwright 登录 `http://127.0.0.1:4173`，进入 `/w/ai-capability-center/workflows`。
- 选中画布节点后，节点配置面板出现复制入口。
- 点击复制后，React Flow 节点数从 2 增加到 3。
- 截图证据：`.scratch/v0.23b-workflow-node-duplicate/browser-duplicate-acceptance.png`。

## 非目标

- 不实现多选复制。
- 不实现键盘复制/粘贴。
- 不实现跨工作流复制。
- 不实现撤销或重做。
