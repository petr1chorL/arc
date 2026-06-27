# Issue 01：持久化 Regression Run

Category: enhancement
Status: done
PRD: `../PRD.md`

## 建设内容

新增可持久化的 Regression Run，批量回归时一次性创建运行摘要，并保存每条样本对应的 Evaluation 记录。

## 验收标准

- [x] 后端可以用 Rubric + Golden Set 创建 Regression Run。
- [x] 后端可以用 Rubric + 手动样本创建 Regression Run。
- [x] Regression Run 记录包含样本总数、通过数、失败数、通过率、Rubric、样本集和 Evaluation IDs。
- [x] 前端批量回归运行后展示本次结果与最近运行历史。
- [x] 刷新页面后最近运行历史仍可读取。

## 前置依赖

V0.9H Golden Set / 回归样本集管理。

## 处理记录

- 2026-06-27：完成 V0.10A 实现与验收。
- 后端和前端 focused 测试通过，全量测试、lint、build 通过。
- 浏览器验收确认运行后历史可见，刷新后仍可读取，控制台无 error/warn。
