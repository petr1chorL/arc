# V0.24E 验收记录：Schema 字段选择器

## 范围

- 工作流连线映射面板读取当前工作流 `inputSchema.properties` 的一层字段。
- 源字段快捷选择写入 `$.<field>`。
- 目标字段快捷选择写入 `$.input.<field>`。
- 保留原有自由文本输入，不改变 `edge.data.mappings` 契约和后端 API。
- 空 Schema 或不支持的复杂 Schema 不显示快捷选择器，继续使用原有输入方式。

## 验收结果

- RED：新增 `uses schema field picker shortcuts for edge mappings` 测试后，先因找不到 `源字段快捷选择 1` 失败，证明目标行为缺失。
- GREEN：实现字段选择器后，聚焦测试通过。
- 全量 Workflows 测试：`28 passed`。
- `npm run lint`：通过。
- `npm run build`：通过；仍保留既有 Vite 大 chunk 警告。
- 浏览器验证：连线映射面板可通过下拉选择生成 `$.asin` 与 `$.input.asin`。

## 验证命令

```powershell
npm test -- --run src/pages/Workflows.test.tsx -t "schema field picker"
npm test -- --run src/pages/Workflows.test.tsx
npm run lint
npm run build
```

## 浏览器证据

- 截图：`.scratch/v0.24e-schema-field-picker/browser-schema-field-picker.png`
- 断言结果：

```json
{"ok":true,"sourcePath":"$.asin","targetPath":"$.input.asin"}
```

## 尚未覆盖

- 不支持嵌套字段展开。
- 不支持完整 JSONPath 编辑器。
- 不读取节点输出 Schema 或 Data Object 目录。
- 不改变运行时映射执行逻辑。
