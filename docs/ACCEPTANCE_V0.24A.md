# V0.24A 验收记录：工作流输入输出 Schema

## 范围

V0.24A 为工作流草稿增加工作流级 `inputSchema` 和 `outputSchema`：

- 后端持久化两段 JSON Schema。
- 创建、更新、读取和发布 WorkflowVersion 快照均包含两段 Schema。
- 工作流编排页可编辑输入 Schema 和输出 Schema。
- 非合法 JSON 对象会在前端阻断保存。

本版本不改变运行接口，不实现节点级字段映射，也不生成运行表单。

## 自动化验收

已通过：

```powershell
apps\api\.venv\Scripts\python.exe -m pytest apps/api/tests/test_workflow_lifecycle_api.py apps/api/tests/test_v07a_migrations.py -q -ra
npx vitest run src/api/workflows.test.ts src/pages/Workflows.test.tsx --reporter verbose --pool=forks --fileParallelism=false --testTimeout 15000
npm run lint
npm run build
npx vitest run src/api src/components src/auth src/domain src/App.test.tsx --pool=forks --fileParallelism=false --testTimeout 15000 --reporter verbose
npx vitest run src/pages/ActivateInvitation.test.tsx src/pages/AgentDetail.test.tsx src/pages/Agents.test.tsx src/pages/AssetLibrary.test.tsx src/pages/AuditLog.test.tsx src/pages/Login.test.tsx src/pages/Members.test.tsx src/pages/ModelProviders.test.tsx --pool=forks --fileParallelism=false --testTimeout 15000 --reporter verbose
npx vitest run src/pages/Evaluations.test.tsx src/pages/Reviews.test.tsx --pool=forks --fileParallelism=false --testTimeout 15000 --reporter verbose
npx vitest run src/pages/Observability.test.tsx src/pages/Runs.test.tsx --pool=forks --fileParallelism=false --testTimeout 15000 --reporter verbose
```

关键结果：

- 后端工作流生命周期测试：11 passed。
- 前端工作流与 API 聚焦测试：24 passed。
- 前端分组回归：68 passed、28 passed、32 passed、23 passed。
- `npm run lint` 通过。
- `npm run build` 通过，仍保留既有 Vite chunk-size warning。

## 浏览器验收

使用临时 API 数据库与 Playwright 完成：

1. 登录测试 Workspace。
2. 打开工作流编排页。
3. 编辑输入 Schema：
   ```json
   {
     "required": ["asin"],
     "properties": {
       "asin": { "type": "string" }
     }
   }
   ```
4. 编辑输出 Schema：
   ```json
   {
     "required": ["summary"],
     "properties": {
       "summary": { "type": "string" }
     }
   }
   ```
5. 点击保存草稿，断言保存接口返回的 `inputSchema.required` 为 `["asin"]`，`outputSchema.required` 为 `["summary"]`。
6. 将输入 Schema 改为 `[]`，点击保存草稿，断言页面出现错误并且没有发起保存请求。

截图证据：

- `.scratch/v0.24a-workflow-io-schema/browser-workflow-io-schema-verified.png`

## 验收结论

V0.24A 的工作流级输入输出 Schema 已可编辑、可保存、可读取、可发布冻结，并能阻断非法对象值。节点级输入输出映射、字段级可视化编辑器和运行表单生成进入后续 V0.24 切片。
