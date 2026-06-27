# Issue 01：失败样本聚类与原因摘要

Category: enhancement
Status: done
PRD: `../PRD.md`

## 建设内容

在评估中心 Regression Run 趋势区中，基于最新 Run 的失败 Evaluation 记录展示失败原因聚类摘要。

## 验收标准

- [x] 最新 Run 存在失败记录时，页面展示 `Failure Pattern Summary`。
- [x] 摘要区展示最新 Run 的失败样本总数。
- [x] 失败样本按最低评分维度聚类。
- [x] 每个原因组展示原因标题、样本数、平均分和代表样本 ID。
- [x] 没有失败记录时不展示该区块。
- [x] 原有趋势、洞察、Run 详情和 Run 对比功能不回归。

## 前置依赖

V0.10E Regression Run 质量洞察摘要。

## 处理记录

- 2026-06-27：进入开发。
- 2026-06-27：完成红灯测试、实现、focused 测试和验收文档。
- 2026-06-27：补充列表无 records、详情有 records 的真实接口形态覆盖；完成全量测试、lint、build 与浏览器验收。
