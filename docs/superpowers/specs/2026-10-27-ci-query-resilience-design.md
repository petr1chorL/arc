# 发布门禁查询：认证与有界恢复

状态：按用户继续修复发布的授权实施；不改变成功门禁，不创建或读取现有真实Token。

## 证据与底层目标

用户提供的Netlify诊断截图报告verify-ci-release.mjs收到GitHub HTTP403；当前源码确认所有查询均匿名，
没有读取任何GitHub认证变量。截图未包含响应头，故“明确为限流”尚未证实；权限/平台策略拒绝也不能排除。
目标是可靠读取同一提交的真实CI结果，不是让失败CI发布。

## 实现与边界

1. scripts/verify-ci-release.mjs：可选NETLIFY_CI_READ_TOKEN仅在构建执行入口读取并作为函数参数传入。
   只发往固定api.github.com仓库Actions端点；禁止跟随重定向，不输出Token、响应正文或原始网络异常。
2. 单次门禁总HTTP额外重试预算2次。网络异常/502/503/504短退避；401/一般403不自动重试。
   403仅在Retry-After或remaining=0等限流证据下重试；429属于限流。
3. 同时尊重Retry-After与X-RateLimit-Reset的较晚时间。等待超过60秒或信息不足以安全重试时停止，
   不缩短上游等待，也不无限阻塞构建。CI运行状态原有21次轮询策略保持。
4. 原SHA/仓库/事件/workflow/latest-run/verify-job校验完全保留；运行ID须为合法正整数，不能用于任意路径。
   JSON异常、跳过、失败、取消都失败关闭。
5. scripts/verify-ci-release.test.mjs：先RED后GREEN，覆盖双请求认证、重定向、限流时序与预算、非限流403、
   认证错误、网络异常脱敏和恢复后仍拒绝失败/错误版本CI。
6. 发布说明：Token由用户在安全入口配置，fine-grained仅petr1chorL/arc的Actions只读权限；
   Netlify仅Builds/Production，不能进入Functions或VITE_变量。不复制CLI登录凭证或索取聊天中的Token值。

## 验证

先跑聚焦Vitest门禁测试和部署契约，再lint/build；独立双轴复审后提交，最终以新提交CI与云端发布核验。
不把测试替身验证当成已配置真实Token；限流证据不足时不能保证添加认证一定解决403。

官方依据：
- https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api
- https://docs.github.com/en/rest/actions/workflow-runs
- https://docs.github.com/en/rest/actions/workflow-jobs
