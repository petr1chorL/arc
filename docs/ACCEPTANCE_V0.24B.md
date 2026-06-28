# V0.24B 验收记录：连线字段映射

## 范围

V0.24B 为工作流连线增加第一版字段映射配置：

- API 接收并返回 `edge.data.mappings`。
- WorkflowVersion 发布快照保留连线映射。
- 工作流编排页的连线配置面板可新增、编辑、删除映射行。
- 保存草稿前会阻断字段不完整的映射行。

本版本不改变工作流执行引擎，不做运行时变量传递。

## 自动化验收

已通过：

```powershell
apps\api\.venv\Scripts\python.exe -m pytest apps/api/tests/test_workflow_lifecycle_api.py -q -ra
npx vitest run src/domain/workflows.test.ts src/pages/Workflows.test.tsx --reporter verbose --pool=forks --fileParallelism=false --testTimeout 15000
npm run lint
npm run build
```

关键结果：

- 后端工作流生命周期测试：5 passed。
- 前端工作流页面与 domain 转换测试：26 passed。
- `npm run lint` 通过。
- `npm run build` 通过，仍保留既有 Vite chunk-size warning。

## 浏览器验收

使用当前构建产物 preview、临时 API 和临时 SQLite 完成：

1. 登录测试 Workspace。
2. 打开工作流编排页。
3. 点击默认连线 `start-agent`。
4. 在连线配置面板新增字段映射。
5. 填写 `$.asin -> $.input.asin`。
6. 点击保存草稿，断言保存接口返回：
   ```json
   {
     "sourcePath": "$.asin",
     "targetPath": "$.input.asin"
   }
   ```
7. 清空下游字段后再次保存，断言页面出现错误且没有发起保存请求。

截图证据：

- `.scratch/v0.24b-edge-mapping/browser-edge-mapping-verified.png`

## 验收结论

V0.24B 的连线字段映射已可编辑、可保存、可读取、可发布冻结，并能阻断字段不完整的映射行。运行时按映射传递节点输入输出、Schema 字段选择器和 Data Object 资产进入后续 V0.24 切片。
