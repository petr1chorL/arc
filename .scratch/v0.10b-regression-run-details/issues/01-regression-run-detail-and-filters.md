# Issue 01：Regression Run 详情与筛选

Category: enhancement
Status: done
PRD: `../PRD.md`

## 建设内容

让用户可以筛选 Regression Run 历史，并点击某次 Run 查看样本级 Evaluation 明细。

## 验收标准

- [x] 后端可以通过 Run ID 读取当前 Workspace 的 Regression Run 详情。
- [x] 后端对不存在或非当前 Workspace 的 Run 返回 404。
- [x] 前端历史区可以按 Rubric 筛选 Run。
- [x] 前端历史区可以按运行状态筛选 Run。
- [x] 点击 Run 卡片打开详情弹窗。
- [x] 详情弹窗展示每条样本的输入、得分、状态、评分说明和 Evaluation ID。
- [x] 已有批量回归、Evaluation 记录和 Rubric 管理测试不回归。

## 前置依赖

V0.10A Regression Run 历史。

## 处理记录

- 2026-06-27：进入开发。
- 2026-06-27：完成后端详情 API、前端筛选与详情弹窗。
- 2026-06-27：完成 focused/backend/frontend 全量测试、lint、build 与浏览器验收。浏览器截图见 `.scratch/v0.10b-regression-run-detail.png`。
