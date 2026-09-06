# Workflow 云端门禁修复计划

1. `e2e/workflow-governance.spec.ts`：增加版本状态断言，9 项本地浏览器重放确认 429。
2. `src/pages/Workflows.test.tsx`：延迟量规目录，卸载后释放响应，断言不再请求版本；先 RED。
3. `src/pages/Workflows.tsx`：初始目录解析后检查 isActive，再执行版本子查询。
4. `e2e/workflow-governance.spec.ts`：执行禁止规则只对 API 路径判断；外域仍全部禁止。
5. 运行 Workflow 单元测试、完整 9 项资产浏览器、lint/build；移除合成诊断探针，记录结果。
