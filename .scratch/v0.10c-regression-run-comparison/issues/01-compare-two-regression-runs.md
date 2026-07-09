# Issue 01：对比两次 Regression Run

Category: enhancement
Status: done
PRD: `../PRD.md`

## 建设内容

让用户在 `Regression Run History` 中选择一个基准 Run 和一个目标 Run，点击后查看两次运行的质量变化。

## 验收标准

- [x] 用户可以选择基准 Run。
- [x] 用户可以选择目标 Run。
- [x] 两个 Run 相同或不足两个 Run 时，对比按钮不可执行。
- [x] 点击对比后会读取两次 Run 详情。
- [x] 页面展示通过率、通过样本、失败样本和总样本变化。
- [x] 页面展示样本级变化，至少包含失败变通过、通过变失败、持续失败和新增失败。
- [x] 已有 Regression Run 历史筛选与详情弹窗不回归。

## 前置依赖

V0.10B Regression Run 详情与筛选。

## 处理记录

- 2026-06-27：进入开发。
- 2026-06-27：完成前端 Run 对比控件、详情读取、差异计算与结果面板。
- 2026-06-27：完成 focused/full 测试、lint、build 与浏览器验收。截图见 `.scratch/v0.10c-regression-run-comparison.png`。
