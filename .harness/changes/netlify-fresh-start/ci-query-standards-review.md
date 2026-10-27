# CI 查询恢复 Standards 独立审查

日期：2026-10-27。对象：`scripts/verify-ci-release.mjs`、对应测试的未提交增量，以及 07i 和已确认设计。只读审查实现，仅写本报告；未读真实 Token、调用真实 GitHub、修改生产或部署。

## 结论

已证实严重问题：0。可以继续既定 CI/发布验证，但不能把匿名请求和截图 403 推断为已经证实的限流根因，也不能声称真实认证已配置或恢复。

## 核验要点

- 凭证仅从 CLI 执行入口的专用服务端环境变量进入参数；默认匿名行为保留。拒绝空、空格、换行、非 ASCII、超长及非字符串 Token，失败消息不包含值。
- GitHub origin 与仓库 Actions 路径为源代码常量；SHA 严格为 40 位十六进制，jobs ID 必须为正 safe integer，不能注入其他路径。两个请求共享认证 header，`redirect: error` 阻断将 Bearer 带往重定向地址。没有新依赖或第三方外呼。
- 网络异常和 JSON 解析异常变为固定消息，HTTP 错误不读正文且尝试取消 body，不输出原始 transport error。既有 CI conclusion 展示仍来自 GitHub 状态字段，不输出整个响应或请求头。
- 额外 HTTP 重试预算位于整个函数调用作用域，不按 runs/jobs 或轮询轮次重置。单请求 15 秒超时；网络及 502/503/504 有界退避；401/普通 403/404 立即失败。HTTP/网络恢复后仍必须重新取得真实成功响应，不以重试耗尽代替成功。
- 429 或带 Retry-After/remaining=0 证据的 403 才进入限流分支。remaining=0 时必须有合法 reset，并选择 Retry-After 与 reset 较晚者，reset 加 1 秒裕量；未知或超过 60 秒的等待失败关闭，不削短上游等待。Retry-After 非数字（包括 HTTP-date）当前保守拒绝而非提前重试，影响可用性但不放宽门禁。
- 原 exact SHA、仓库、push、workflow 文件、最新 matching run、completed/success 以及 verify job completed/success 校验均保留；较新失败不会被较旧成功覆盖。原 21 次 CI 状态轮询与额外 HTTP 错误重试为不同预算。
- Builds/Production 与 Actions 只读权限属于后续真实平台配置约束，源码不能证明平台 scope 已设置；未把可选认证支持描述成配置完成。

## 本轮独立验证

`node node_modules/vitest/vitest.mjs run scripts/verify-ci-release.test.mjs`：1 文件、39 项通过（本次实际输出，未复用主线程汇总的 40 项数字）。仅内存 fetch/sleep 替身，没有真实网络或等待。

测试覆盖认证 header、禁止重定向配置、较晚限流时间、共享预算、认证失败不重试、错误恢复后仍拒绝错误 CI、非法运行 ID 和既有发布绑定。可选低优先级改进：脱敏用例当前使用 `toThrow` 子串断言，未来可追加精确 message 或显式不包含 sentinel 断言以防回归；当前源码已是固定消息，不构成严重项。

独立审查未重跑全量 lint/build，也不将主线程的成功记录改写为本审查执行证据。最终发布仍须针对新 SHA 核验真实 CI 和 Netlify 构建结果。
