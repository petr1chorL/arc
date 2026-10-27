# Qwen验收预算保护本地回执

日期：2026-10-27。仅本地候选；未启用生产profile、未读取凭证、未发出真实模型请求、未修改生产数据。

## RED → GREEN

- 新测试首次执行因`acceptanceProfile`尚不被运行配置接受而失败：`NotSentError: 运行依赖配置无效`。
- 最小实现后首项测试通过；补充边界后9项纯测试全部通过。
- 用例覆盖20次跨assembly持久预留、失败不退款、精确绑定/请求限制、remote与Tool拒绝、DB connect/query/release固定化错误、关闭及无profile兼容、输出低于512时保留用户上限、取消期间不外发。
- `scripts/native-runtime-config.test.mjs`：6项既有兼容测试通过。
- `scripts/native-deployment.test.mjs`：6项既有模式/路由/Origin测试通过。
- Vitest `scripts/test-runner-boundary.test.mjs`：1项通过；新纯测试由runtime前缀排除jsdom，两新程序均已加入原生CI verifier。
- `npm run typecheck:netlify`、`npm run lint`、`git diff --check`通过（仅CRLF提示）。

## 尚未验证

主线程补充：完整npm run build通过；Spec与Standards两个独立审查均无已证实严重问题，各自重新运行9项预算纯测试通过。Spec另运行Layout7项通过。审查仅放行CI，不代表PG并发或生产模型验收完成。

- 本机无可用隔离PostgreSQL。新增`runtime-acceptance-budget-postgres.mjs`的40并发争20额度及重连保持测试必须在现有CI PostgreSQL中运行；不能由内存模拟声称PG竞争通过。
- 本轮曾运行含PG的native-api-host程序，2项纯用例通过，PG用例因本机数据库不可用失败；已中止本轮该测试进程。不是应用缺陷结论，也不是完整宿主验证通过。
- 真实普通按量模型请求、账单、AWL持久业务、生产profile与新表发布尚待主线程后续核验。

## 对抗式检查

- 预算只增加、从不退款；预留提交后进程崩溃或release异常可浪费额度，不会额外放行。
- 原子条件upsert具有固定ID与表级20上限；每个部署/Function实例共享同一生产库行；没有重置代码或开放预算API。
- profile必须服务端选择，不接受请求传入；mode关闭不访问loadAcceptancePool；普通模式不改变现有网关请求。
- 仅固定普通按量端点、模型、Workspace与Secret Ref可通过；额外工具/搜索/多候选/多模态字段不进入传输；remote拒绝，HTTP Tool白名单为空，现有MCP/Manual工具不执行外部调用。
- `max_completion_tokens`含思考与答案，明确关闭思考；官方允许最多10tokens偏差，预算计算包含该余量。
- 金额为本次验收保守预留，不把人民币写成美元账单，不包含其他应用使用同一Key的费用。
