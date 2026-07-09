# Issue 01：Regression Run 质量洞察摘要

Category: enhancement
Status: done
PRD: `../PRD.md`

## 建设内容

在评估中心的 Regression Run 趋势区中，增加自动质量洞察摘要，帮助用户直接判断最近回归质量是否稳定、下滑或存在风险。

## 验收标准

- [x] 当至少有 2 次 Regression Run 时，页面展示 `Regression Run Insight`。
- [x] 洞察区展示一个明确状态标题。
- [x] 洞察区展示最新通过率。
- [x] 洞察区展示较上次变化。
- [x] 洞察区展示风险 Run 数。
- [x] 当最新 Run 低于 70% 或较上次下降时，展示可执行建议。
- [x] 原有趋势图、Run 详情和 Run 对比功能不回归。

## 前置依赖

V0.10D Regression Run 趋势视图。

## 处理记录

- 2026-06-27：进入开发。
- 2026-06-27：完成红灯测试、实现、focused 测试和验收文档。
- 2026-06-27：完成后端全量测试、前端全量测试、lint、build 和浏览器验收。
