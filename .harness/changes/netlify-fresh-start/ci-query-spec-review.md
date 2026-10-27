# CI 查询恢复：独立 Spec 轴审查

日期：2026-10-27。对应 Issue 07i 和 `docs/superpowers/specs/2026-10-27-ci-query-resilience-design.md`。

## 结论

已证实的严重/阻断问题：0。实现保持发布成功门禁，新增的是可选认证及有界查询恢复，不是绕过 CI。

本次只审查未提交的 `scripts/verify-ci-release.mjs` 与相邻测试，独立运行替身测试，不读取真实 Token、不访问 GitHub/Netlify 生产服务、不改实现。此报告是本轴唯一文件变更。

## AC 与边界核对

- **凭证边界**：仅直接执行脚本入口读取 NETLIFY_CI_READ_TOKEN，函数接收显式可选参数；非法类型、空串、空白/换行、非 ASCII 及超长值在 fetch 前拒绝。唯一基址为固定 api.github.com/repos/petr1chorL/arc/actions，SHA 限定 40 位十六进制，run ID 限定安全正整数；Authorization 不由响应中 URL 驱动，redirect:error 阻止转发到重定向目的地。异常不打印 Token 或上游正文。
- **恢复边界**：retriesLeft 位于整个 requireSuccessfulCI 调用内，因此 runs/jobs 请求和后续 CI 轮询共享额外两次预算。网络异常及 502/503/504 可短退避；401、没有限流证据的 403、404 直接失败。403 的 Retry-After 或 remaining=0 才进入限流路径；429 进入限流路径。
- **等待边界**：主额度耗尽时 reset 必须有效；Retry-After 与有效 reset 取较晚值，reset 加一秒余量。缺少必要 reset、非法等待或超过单次 60 秒等待上限都失败，不缩短上游等待。503 的长 Retry-After 同样不能被短退避覆盖。无头 429 首次等完整一分钟，再遇相同情况以超预算停止；不是无限等待。HTTP-date 形式 Retry-After 会保守拒绝，不会提前重试。
- **原成功契约**：精确 SHA、push、固定 workflow 路径、固定 head repository 全部保留；按合法 ID 选择最新匹配 run，不允许旧成功遮蔽新失败。只在 completed/success 且 latest jobs 含 completed/success 的 verify 后返回。跳过、失败、取消、错误版本、缺失及超时仍失败关闭；运行状态的原 21 次轮询没有扩大。
- **诊断真实性**：源码支持“原来匿名查询”，截图 HTTP403 不足以证明一定限流。设计如实保留权限/策略拒绝可能，未承诺添加 Token 一定修复。未把旧提交 dc17558 的 CI 成功说成本次新脚本已提交、已配置 Token 或已发布。

## 独立验证

```text
node node_modules/vitest/vitest.mjs run scripts/verify-ci-release.test.mjs scripts/netlify-deployment-policy.test.mjs
```

本轮结果：2 文件、40 项通过，退出码 0。所有请求和等待均为测试替身；无真实凭证或生产外呼。

测试覆盖双查询认证/固定 host/禁止 redirect、后置时间边界、共享重试预算、普通认证失败、长期/缺失等待、503 Retry-After、网络与 JSON 错误脱敏、非法 run ID，以及恢复后仍拒绝失败或错误版本 CI。RED 证据与 lint/build/deploycheck 为主线程提供，本轴不将其冒充独立执行证据。

## 下一门禁

可进入主线程最终合并审查与提交。实际安全配置、精确新 SHA CI、Netlify 构建/发布及原生业务验收仍是独立后续证据；不能凭本报告宣布真实 403 已解决或生产已发布。
