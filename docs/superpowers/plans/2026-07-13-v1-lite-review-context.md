# V1.0 Lite Review Context Implementation Plan

## Goal

修复 V1 Lite 默认工作流“完成但审核后修订缺少方案与审核意见”的数据流缺陷。

## Task 1：建立 RED 证据

File:

- Modify: `apps/api/tests/test_v1_lite_e2e_acceptance.py`

新增断言：暂停时 Artifact 同时包含 `workflowDesign` 与 `rubric`；恢复后的第 4 次模型输入包含
`reviewedArtifact`、`reviewDecision.decision` 和提交的 `reviewDecision.reason`。运行该测试并确认因
当前数据传递缺失而失败。

## Task 2：最小实现

Files:

- Modify: `apps/api/app/v1_lite_seed.py`
- Modify: `apps/api/app/execution.py`

为默认 Human 节点补充方案设计入边，并在 Human -> Revision 边声明 `includeReviewContext`。
恢复服务读取下一条边的该声明；存在时构建结构化审核上下文，否则保留现有 Artifact 正文。

## Task 3：聚焦与回归验证
默认 Workflow 版本提升到 `v1.3.0`，以创建包含修复的新不可变快照。

运行：

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_v1_lite_e2e_acceptance.py -q
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_human_workflow_execution.py -q
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q
npm test -- --run
npm run lint
npm run build
npm run test:e2e
git diff --check
```

## Task 4：记录验收结论

更新 Issue、V1 Lite 状态、当前实现与项目概览。记录第一性原理和对抗式审查结论；在重新部署并
完成真实模型复测前，只能报告工程修复完成，不能报告线上业务验收完成。
