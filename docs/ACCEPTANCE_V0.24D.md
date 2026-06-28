# V0.24D 验收记录：Schema 运行输入表单

## 范围

V0.24D 为工作流运行弹窗增加第一版基于 `inputSchema` 的结构化输入表单：

- 支持一层对象字段：`string`、`number`、`integer`、`boolean`。
- 支持 `required` 必填校验。
- 提交时把表单值序列化为 JSON 字符串，继续使用现有运行 API 的 `input` 字段。
- 空 Schema 或不适合生成表单的 Schema 继续使用自由文本运行输入。

本版本不实现嵌套对象、数组、枚举、默认值、完整 JSON Schema 渲染器或后端 Schema 校验。

## 自动化验证

### RED

命令：

```powershell
npm test -- --run src/pages/Workflows.test.tsx -t "schema run input"
```

结果：

- 失败符合预期。
- 失败原因：运行弹窗找不到 `ASIN` 字段，也没有 `ASIN 为必填项` 校验提示。

### GREEN：聚焦测试

命令：

```powershell
npm test -- --run src/pages/Workflows.test.tsx -t "schema run input"
```

结果：

- 1 个测试文件通过。
- 2 条 V0.24D 聚焦测试通过。

### 回归：工作流页面

命令：

```powershell
npm test -- --run src/pages/Workflows.test.tsx
```

结果：

- 1 个测试文件通过。
- 27 条测试通过。

### Lint

命令：

```powershell
npm run lint
```

结果：

- 通过。

### Build

命令：

```powershell
npm run build
```

结果：

- 通过。
- Vite 保留既有的大 chunk 警告。

### 浏览器验证

方式：

- 临时启动 Vite 到 `http://127.0.0.1:4181`。
- 使用 Playwright 拦截 `/api/*`，返回一个带 `inputSchema` 的工作流。
- 打开 `/w/ai-capability-center/workflows`。
- 在运行弹窗填写 Schema 表单并点击开始运行。

结果：

- 页面成功显示结构化运行输入字段。
- 提交给运行 API 的 `input` 为 `{"asin":"B0BROWSER","score":91,"urgent":true}`。
- 截图：`.scratch/v0.24d-schema-run-form/browser-schema-run-form.png`。

## 功能验收

1. 对于以下输入 Schema：

```json
{
  "type": "object",
  "required": ["asin", "score"],
  "properties": {
    "asin": { "type": "string", "title": "ASIN" },
    "score": { "type": "number", "title": "机会评分" },
    "urgent": { "type": "boolean", "title": "是否加急" }
  }
}
```

运行弹窗显示 `ASIN`、`机会评分`、`是否加急` 三个字段。

2. 填写 `ASIN=B0TEST`、`机会评分=88`、勾选 `是否加急` 后，运行 API 收到的 `input` 可解析为：

```json
{
  "asin": "B0TEST",
  "score": 88,
  "urgent": true
}
```

3. 必填字段 `ASIN` 为空时，页面显示 `ASIN 为必填项`，且不会调用运行 API。

4. 既有空 Schema 工作流仍显示原来的 `运行输入` 文本域，旧运行路径保持兼容。

## 结论

V0.24D 已让工作流输入 Schema 从“定义契约”进入“运行时填写体验”。运行 API 和后端执行链路保持兼容，后续可以继续扩展完整 JSON Schema 渲染、嵌套字段、默认值和后端校验。
