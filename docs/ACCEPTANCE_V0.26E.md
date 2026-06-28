# V0.26E 验收记录：Artifact Schema 轻量校验状态

## 范围

- Artifact 实例页基于 Artifact 内容和 Data Object Snapshot 派生轻量 Schema 校验状态。
- 可支持对象 Schema 且内容满足契约时展示“Schema 校验通过”。
- 缺少必填字段、字段类型不匹配或内容不是合法 JSON 对象时展示“Schema 校验失败”。
- 详情弹窗展示 Schema 状态和失败原因。
- 未绑定 Snapshot 或 Schema 不在支持范围时展示“未校验”。

## 验收结果

- RED：新增页面测试后，找不到“Schema 校验通过”，确认目标行为缺失。
- GREEN：新增轻量校验 helper、列表状态标签和详情失败原因后，聚焦测试通过。
- Artifact 页面测试：`3 passed`。
- 相关前端回归测试：`10 passed`。
- `npm run lint`：通过。
- `npm run build`：通过；保留既有 Vite 大 chunk 警告。
- 浏览器验证：Playwright 打开 `/w/ai-capability-center/artifacts`，确认列表出现“Schema 校验通过”和“Schema 校验失败”，点击失败 Artifact 后在详情弹窗看到“缺少必填字段：summary”；截图见 `.scratch/v0.26c-artifact-catalog-ui/browser-artifacts.png`。

## 验证命令

```powershell
npm run test -- src/pages/Artifacts.test.tsx -t "shows schema validation status" --run
npm run test -- src/pages/Artifacts.test.tsx --run
npm run test -- src/api/artifacts.test.ts src/pages/Artifacts.test.tsx src/components/Layout.test.tsx --run
npm run lint
npm run build
$env:ARC_ONE_PORT='4201'; python C:\Users\a\.codex\skills\webapp-testing\scripts\with_server.py --server "npm run dev -- --host 127.0.0.1 --port 4201" --port 4201 -- node .scratch\v0.26c-artifact-catalog-ui\browser-check.mjs
```

## 覆盖场景

- 合法 JSON 对象包含 required 字段时展示通过。
- JSON 对象缺少 required 字段时展示失败。
- 详情弹窗展示“缺少必填字段：summary”。
- 现有列表、筛选和详情弹窗测试继续通过。

## 尚未覆盖

- 不提供后端持久化校验结果。
- 不执行完整 JSON Schema 校验。
- 不支持数组、枚举、格式、正则、默认值和组合 Schema。
