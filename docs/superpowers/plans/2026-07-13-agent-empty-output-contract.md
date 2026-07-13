# Agent Empty Output Contract Implementation Plan

## Goal

消除“模型空输出但 Agent 节点通过，并由原始输入驱动下游”的假成功路径。

## Task 1：建立 RED 证据

Files:

- Modify: `apps/api/tests/test_agent_runtime.py`
- Modify: `apps/api/tests/test_execution_api.py`

先断言空白响应会重试；耗尽后 Runtime、NodeRun 和 Run 均失败，下游不执行且不产生 Artifact 或
Human Review。运行聚焦测试，确认当前实现因仍标记成功而失败。

## Task 2：最小实现

File:

- Modify: `apps/api/app/agent_runtime.py`

在 ModelGateway 返回后校验 `content.strip()`。空白时继续下一次尝试；全部尝试耗尽时返回固定、
脱敏的空输出失败摘要。保留短但非空内容的原有质量评分行为。

## Task 3：验证

依次运行：

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_agent_runtime.py -q
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_execution_api.py -q
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q
npm test -- --run
npm run lint
npm run build
npm run check:deployment
git diff --check
```

界面行为涉及运行状态，部署后以真实模型重新运行 V1 Lite 工作流，验证空响应不会再显示为通过，
有效响应仍可进入 Human Review。

## Task 4：记录与交付

更新 Issue、V1 Lite 状态、当前实现和项目概览；提交、推送并创建 PR。合并、部署和线上真实模型
复测之前，只报告工程修复状态，不报告线上修复完成。
