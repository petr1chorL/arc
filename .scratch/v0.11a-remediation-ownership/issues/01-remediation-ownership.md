# Issue 01：修复任务负责人、截止时间和筛选

Category: enhancement
Status: done
PRD: `../PRD.md`

## 建设内容

为 Remediation Task 增加负责人、截止时间和筛选能力，让评估闭环进入可运营责任体系。

## 验收标准

- [x] 创建 Remediation Task 时后端保存 `owner`。
- [x] 创建 Remediation Task 时后端保存 `dueDate`。
- [x] 历史 SQLite 表可增量补列。
- [x] `GET /remediation-tasks` 支持 `owner` 查询参数。
- [x] `GET /remediation-tasks` 支持 `priority` 查询参数。
- [x] `GET /remediation-tasks` 支持 `overdue` 查询参数。
- [x] 前端任务卡展示负责人、截止时间和逾期状态。
- [x] 前端支持按负责人筛选。
- [x] 前端支持按优先级筛选。
- [x] 前端支持按逾期状态筛选。
- [x] 原有任务创建、状态流转、复测和闭环看板不回归。

## 前置依赖

V0.10J 评估闭环看板。

## 处理记录

- 2026-06-27：进入开发。
- 2026-06-27：完成红测、实现、全量验证和浏览器验收，Issue 关闭。
