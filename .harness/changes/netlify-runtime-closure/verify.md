# 05/06 本地验证回执

日期：2026-09-06。当前状态：本地工程验证通过，ready-for-human；不等同生产迁移完成。

## 环境与范围

- Windows、本地既有 Node/Playwright/PostgreSQL；未安装新包、未读取真实凭证。
- PG 随机 schema，非空合成业务数据；HTTP 使用实际鉴权/CSRF/Workspace 路由与共享 consumer。
- 模型/HTTP Tool/通知的外部 transport 使用受控响应；不是真实服务送达或模型质量验收。
- 新公开 Function 硬休眠，未部署、推送、切流、备份/迁移生产数据或关闭 Zeabur。

## 测试先行与审查修复

先记录目标模块缺失或行为断言失败，再实现/修复：Operation 幂等与领取、未知发送阻断、
固定版本 Workflow/Agent、原生 HTTP 202、休眠入口、Agent 取消 Run 同步、取消子恢复发送、
终态投影失败共同回滚/claim 阶段终态、评分 82.5 边界，以及旧停用渠道遮挡有效渠道。
具体复现和独立重验在 `spec-review.md`、`standards-review.md`。

## 已通过证据

- 设置非敏感 `ARC_RUNTIME_TEST_PORT=55433` 后运行 `node scripts/verify-runtime-local.mjs`：
  最终冻结代码 12 个程序完整退出 0（8.96 秒）。
  其中 Ledger 最新 12/12、Gateway 4/4、Workflow/Agent 2/2、HTTP 1/1、休眠入口 1/1；
  通知策略 13、通知/调度 PG 最终 51、Agent Tool 29、闭环策略 9，以及三个闭环 PG 程序。
- 通知渠道最后补丁独立 PG 51 项通过；`ARC_RUNTIME_TEST_PORT=0` 负例在连接前退出 1。
- 主线程再次执行 `node node_modules/@playwright/test/cli.js test --config=playwright.runtime.config.ts`，
  真实 Chromium 最终 5 条通过（36.2 秒）；完整人审链、受控实际评分/核对权限、
  计划/站内通知、Agent 202 执行、产出物/观测页面。截图在 `test-results/runtime-closure-*/`。
- 最终冻结版本完整前端回归 **68 文件 / 677 项通过，115.60 秒，退出 0**。
  命令基于 `node node_modules/vitest/vitest.mjs run --maxWorkers=1 --no-file-parallelism`，
  附加 default 与临时 test_start/test_end 日志 reporter；reporter 不修改筛选、测试或断言，收尾已移除。
  此数字覆盖了此前 19 文件 190 项、状态映射 5 项和较早完整回归 672 项，不把它们相加。
- 最新 `npm run lint`、`npm run build`、`npm run deploy:check`、`git diff --check` 退出 0。
  构建保留大于 500KB 的 bundle 体积警告；Git 仅 CRLF 提示。

## 最终复验环境事件

最后一次全程序运行在闭环评估断言通过后的 schema 清理阶段失败：PostgreSQL
`53100 / No space left on device / pg_wal`。只读 Docker 检查确认
`arc-one-migration-test-55432` 为无持久挂载、256MB tmpfs 的本地合成测试容器，已退出。
这次命令退出 1，不能写成全量通过。已使用缓存镜像（`--pull never`）创建独立 1GB tmpfs
容器 `arc-one-runtime-verify-20260906`，仅绑定 `127.0.0.1:55433`，重新完整通过 12 程序和
5 条浏览器。清理后只读 SQL 确认随机 `runtime_<32hex>` schema 数量为 0，随后停止并由
`--rm` 移除该临时容器，无持久挂载；未删除任何原有容器或业务数据。

一次默认 reporter 全量前端测试出现持续 CPU 占用、约 3.3GB 内存且长时间无输出；
仅定点停止其已核实 PID 7224/47552，用 `--reporter=verbose` 重放定位。该异常不能
凭后续通过推定根因，也不应无证据修改业务代码。第二次 verbose 重放同样停滞，
定点停止已核实 PID 47888/47804；Observability 单例及完整 12 例独立均通过。
第三次加入 test_start/test_end 诊断 reporter 后全部 68 文件 / 677 项通过，115.60 秒。
未改变测试内容/隔离方式或跳过用例，未对业务实现作猜测性修复。该间歇测试运行器异常
仍未确认根因，保留为后续工具链稳定性事项，不虚称已根治。

## 尚未执行

GitHub Actions 云端运行、Netlify AWL 云端认证投递/超时与跨部署恢复、真实模型/通知、
生产备份恢复/数据对账/切流回滚及观察窗口。它们属于后续上线验收，不能由本回执证明。
