# V0.24F 验收记录：运行输入 Schema 后端校验

## 范围

- 工作流运行入口基于已发布 WorkflowVersion 快照中的 `inputSchema` 校验输入。
- 当前支持简单一层对象字段：`string`、`number`、`integer`、`boolean`。
- 支持 `required` 必填字段校验。
- 校验失败返回 `422`，不创建 Run，不调用模型。
- 空 Schema 或不支持的复杂字段类型继续兼容旧自由文本输入。

## 验收结果

- RED：新增缺少必填字段测试后，接口仍返回 `201 Created`，证明后端未校验运行输入。
- GREEN：实现后端轻量校验后，Schema 相关 4 个测试通过。
- 完整运行接口测试：`37 passed`。
- 语法检查：`python -m py_compile app/main.py` 通过。
- `npm run lint`：通过。
- `npm run build`：通过；仍保留既有 Vite 大 chunk 警告。

## 验证命令

```powershell
.\.venv\Scripts\python.exe -m py_compile app\main.py
.\.venv\Scripts\python.exe -m pytest tests/test_execution_api.py -k schema -q
.\.venv\Scripts\python.exe -m pytest tests/test_execution_api.py -q
npm run lint
npm run build
```

## 覆盖场景

- 缺少 `required` 字段时返回 `422`。
- `number` / `boolean` 类型不匹配时返回 `422`。
- 合法 JSON 对象输入继续创建并执行 Run。
- 不支持的 `array` 字段 Schema 继续允许自由文本输入。
- 校验失败时 `ModelGateway` 未被调用，数据库中不创建 `WorkflowRunRecord`。

## 尚未覆盖

- 不支持完整 JSON Schema 语义。
- 不支持嵌套对象、数组、枚举、格式、正则、默认值、最小值/最大值。
- 不实现前端新交互。
- 不引入 Data Object 资产。
