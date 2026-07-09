# Issue 01：修复任务关联复测

Category: enhancement
Status: done
PRD: `../PRD.md`

## 建设内容

将已完成 Remediation Task 与新的 Regression Run 复测关联起来，让用户能从任务卡直接发起复测并看到结果。

## 验收标准

- [x] 后端支持对已完成 remediation task 发起复测。
- [x] 后端用来源 Run 的 Rubric 和任务代表样本创建新的 Regression Run。
- [x] 后端把新 Run ID 写回 remediation task。
- [x] 后端重复复测时返回已有 `retestRunId`，不创建重复 Run。
- [x] 未完成任务发起复测返回 409。
- [x] 前端任务卡在任务完成后展示 `发起复测`。
- [x] 点击复测后任务卡展示复测 Run ID、通过率和失败数。
- [x] 原有任务创建、状态流转、趋势、洞察、失败聚类和修复队列不回归。

## 前置依赖

V0.10H 失败修复任务。

## 处理记录

- 2026-06-27：进入开发。
- 2026-06-27：后端红绿、前端红绿、全量测试、lint、build 和浏览器验收通过。
