# Issue 01：失败修复任务

Category: enhancement
Status: done
PRD: `../PRD.md`

## 建设内容

将评估中心的修复队列项转成 Workspace 级可追踪任务，支持创建、列表读取和状态更新。

## 验收标准

- [x] 后端支持创建 remediation task。
- [x] 相同 Workspace 下同一 `sourceRunId + clusterKey` 重复创建时返回已有任务。
- [x] 后端支持按 Workspace 列表读取 remediation task。
- [x] 后端支持将任务状态更新为 `in_progress` 或 `done`。
- [x] 评估中心能从 `Failure Remediation Queue` 创建任务。
- [x] 创建后页面展示任务列表与当前状态。
- [x] 页面能将任务标记为处理中或已完成。
- [x] 原有趋势、洞察、失败聚类、修复队列、Run 详情和 Run 对比功能不回归。

## 前置依赖

V0.10G 失败原因修复队列。

## 处理记录

- 2026-06-27：进入开发。
- 2026-06-27：focused 后端与前端测试通过，进入全量验证。
- 2026-06-27：后端全量、前端全量、lint、build 和浏览器验收通过。
