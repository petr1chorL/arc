# V0.26D 验收记录：Artifact 详情弹窗

## 范围

- Artifact 实例页的每条卡片新增“查看详情”操作。
- 点击后打开只读 Artifact 详情弹窗。
- 详情展示 ArtifactVersion ID、Artifact ID、Run ID、NodeRun ID、Data Object Version ID 和 Score。
- Artifact 内容如果是 JSON，会格式化展示；无法解析时显示原文。
- Data Object Snapshot 以格式化 JSON 展示。
- 弹窗可关闭。

## 验收结果

- RED：新增页面测试后，找不到“查看 artifact-version-1 详情”按钮。
- GREEN：新增详情按钮、弹窗、格式化内容和 Snapshot 后，聚焦测试通过。
- Artifact 页面测试：`2 passed`。
- 相关前端回归测试：`9 passed`。
- `npm run lint`：通过。
- `npm run build`：通过；保留既有 Vite 大 chunk 警告。
- 浏览器验证：Playwright 打开 `/w/ai-capability-center/artifacts`，点击 Artifact 详情，确认弹窗、格式化内容和 Data Object Snapshot 可见；截图见 `.scratch/v0.26c-artifact-catalog-ui/browser-artifacts.png`。

## 验证命令

```powershell
npm run test -- src/pages/Artifacts.test.tsx -t "opens an artifact detail" --run
npm run test -- src/pages/Artifacts.test.tsx --run
npm run test -- src/api/artifacts.test.ts src/pages/Artifacts.test.tsx src/components/Layout.test.tsx --run
npm run lint
npm run build
node .scratch/v0.26c-artifact-catalog-ui/browser-check.mjs
```

## 覆盖场景

- 点击 Artifact 卡片的详情操作。
- 弹窗展示 ArtifactVersion、Run 和 NodeRun 来源。
- 弹窗展示格式化后的 Artifact JSON 内容。
- 弹窗展示格式化后的 Data Object Snapshot。
- 弹窗可以关闭。

## 尚未覆盖

- 不提供独立详情 URL。
- 不新增后端详情 API。
- 不做复制、下载、导出或编辑。
- 不执行 Schema 校验。
