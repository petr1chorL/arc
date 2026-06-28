# V0.25D 验收记录：工作流节点绑定 Data Object

## 范围

- Workflows 页面加载当前 Workspace 的 Data Object Definitions。
- 节点配置面板新增 `Data Object 契约` 区域。
- 每个节点可分别选择输入 Data Object 与输出 Data Object。
- 选择后展示名称、版本、状态和 Schema 摘要。
- 保存草稿时，节点 `data.inputDataObjectRef` 和 `data.outputDataObjectRef` 随现有工作流草稿 PATCH 请求持久化。

## 验收结果

- RED：新增 Workflows 测试后，页面找不到 `输入 Data Object` 控件，测试失败。
- GREEN：实现 Data Object 加载、节点面板控件和 ref 写入后，聚焦测试通过。
- Workflows 回归测试：`29 passed`。
- 浏览器验证：真实页面可选中节点、绑定输入/输出 Data Object、保存草稿，且 PATCH body 包含两个 Data Object ref。
- `npm run lint`：通过。
- `npm run build`：通过；保留既有 Vite 大 chunk 警告。

## 验证命令

```powershell
npx vitest run src/pages/Workflows.test.tsx -t "binds data objects" --reporter verbose
npx vitest run src/pages/Workflows.test.tsx --reporter verbose
npm run lint
npm run build
```

## 浏览器验证

验证脚本使用 Playwright 模拟登录、Workspace、Workflow、Data Object 和保存草稿 API，打开：

```text
http://127.0.0.1:4190/w/ai-capability-center/workflows
```

验证结果：

- 选中 `Human Review` 节点后出现 Data Object 绑定控件。
- 输入 Data Object 可选择 `Product Research Input`。
- 输出 Data Object 可选择 `Review Decision Output`。
- 节点面板显示对应版本、状态和 Schema 摘要。
- 保存草稿后，PATCH body 中包含：
  - `inputDataObjectRef.definitionId = data-object-input`
  - `inputDataObjectRef.schemaSummary = required: asin`
  - `outputDataObjectRef.definitionId = data-object-output`
  - `outputDataObjectRef.schemaSummary = required: decision`

截图证据：

```text
.scratch/v0.25d-workflow-data-object-binding/browser-workflow-data-object-binding.png
```

## 尚未覆盖

- 不改变运行时 Artifact 实例化。
- 不改变连线字段映射执行逻辑。
- 不强制发布工作流时必须绑定已发布 Data Object。
- 不提供 Data Object 版本历史选择。
- 不提供 Schema 字段树或可视化 JSON Schema Builder。
