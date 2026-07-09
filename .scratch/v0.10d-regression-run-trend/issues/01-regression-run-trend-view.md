# Issue 01：Regression Run 趋势视图

Category: enhancement
Status: done
PRD: `../PRD.md`

## 建设内容

让用户在评估中心无需手动对比，也能看到最近 Regression Run 的通过率趋势和摘要指标。

## 验收标准

- [x] 当至少有 2 次 Regression Run 时，页面展示 `Regression Run Trend`。
- [x] 趋势区展示最新通过率。
- [x] 趋势区展示较上次变化。
- [x] 趋势区展示平均通过率和最佳通过率。
- [x] 趋势区展示最近 Run 的轻量柱状趋势，并通过可访问标签保留 Run ID。
- [x] 低通过率 Run 有风险标记。
- [x] 原有 Run 详情和两次 Run 对比功能不回归。

## 前置依赖

V0.10C Regression Run 对比。

## 处理记录

- 2026-06-27：进入开发。
- 2026-06-27：完成红灯测试、实现、focused 测试和验收文档。
- 2026-06-27：完成后端全量测试、前端全量测试、lint、build 和浏览器验收。
