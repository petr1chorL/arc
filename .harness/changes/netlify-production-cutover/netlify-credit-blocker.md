# Netlify 云构建额度阻断（只读核查）

核查日期：2026-09-06。站点：`arc-one-agentic-os`，ID `0ba326b9-88aa-4df4-8fab-daa2ae5894b7`。

## 结论

Git push **已触发云构建**，不是未推送、仓库未关联或构建开关关闭。最近四次 production 构建全部被平台以
`Skipped due to account credit usage exceeded` 跳过。重复触发构建、重新关联仓库或修改 CI 门禁不能消除该额度阻断。

本次不重试、不升级、不充值、不创建 build hook、不更改站点配置。需要账号额度恢复，或先取得明确费用授权后由主线程处理计费选择。
没有证据支持自动购买套餐或开启 auto recharge；未执行任何收费动作。

## 已核实的构建与发布记录

证据来源：已缓存 Netlify CLI v27.4.2，使用现有登录执行只读 `listSiteBuilds`、`listSiteDeploys`、`getSite`。
CLI stdout 由 Node `spawnSync` 在内存捕获并 JSON 解析，只输出白名单字段；未打印原始 API 响应，未读取凭证文件或环境变量值。

| Commit | Build ID | Deploy ID | 创建时间 UTC | 结果 |
|---|---|---|---|---|
| `0a35e9291a53aea6712efd0ccf81581fedda646c` | `6a9d34db0d2ff6000875716d` | `6a9d34db0d2ff6000875716f` | 2026-09-06 09:39:40 | credit 超限跳过 |
| `2f51d8e085b9da9857b66286779848d151073916` | `6a9d2a91a413be00087782bd` | `6a9d2a91a413be00087782bf` | 2026-09-06 08:55:45 | credit 超限跳过 |
| `1940c36f5f2d8ddc90b8151bdfb8f92e9401f778` | `6a9d25108884b80008e9735d` | `6a9d25108884b80008e9735f` | 2026-09-06 08:32:16 | credit 超限跳过 |
| `4c65b48f05a448b233d34340d1a0da303ce39261` | `6a9d2306a256f200089eaef8` | `6a9d2306a256f200089eaefa` | 2026-09-06 08:23:34 | credit 超限跳过 |

四条均 `done=true`、deploy `state=error`、`skipped=true`、`published_at=null`、branch=`codex/harness-governance`、context=`production`。

当前 `published_deploy` 仍是 `6a9d1d993c53f700086e848e`，commit=`b62660223dad8b43a725bd9bf847959ac511b2a8`，state=`ready`，
published_at=`2026-09-06T08:14:23.375Z`。这是发布记录，不等同本次进行了站点实时访问或业务健康检查。

## Git 持久关联与构建配置

`getSite` 返回：provider=`github`，repo_path=`petr1chorL/arc`，repo_url=`https://github.com/petr1chorL/arc`，
repo_branch=`codex/harness-governance`，allowed_branches=`["codex/harness-governance"]`，stop_builds=`false`。
installation_id 为 null；不能单凭这一字段断言 Git 断连，最新精确 commit 的自动构建记录已证明推送触发链当前可达。

站点存储 cmd=`npm run build`；根 `netlify.toml` 为 `node scripts/verify-ci-release.mjs && npm run build`。
官方 API schema 明确 TOML command 覆盖站点 cmd。credit 跳过发生在平台调度阶段，不是该 CI release gate 的脚本失败。
未绕过 exact COMMIT_REF CI 检查，也未修改 `/api/*` 的 Zeabur 代理。

## Credit 用量与重置时间的可见性

本次检查已缓存官方 OpenAPI schema 与当前[官方 OpenAPI 文档](https://open-api.netlify.com/)：
未发现明确支持 credit balance/credit reset 的只读 operation；公开 `getAccount` schema 仅有一般 billing_period 等字段，
不能把月度周期字符串推导成具体重置日期。没有探测未公开计费路由、支付方式接口或收费写接口。

因此，**剩余 credit 数值、实际用量、下次额度恢复日期均未取得，不能报告为 0 或猜测日期。**
平台错误只证明当前 production 发布被 credit policy 阻止，未区分实际耗尽、额度保留状态或需平台支持核查的账号异常。

[Netlify 官方 Credit FAQ](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/billing-faq-for-credit-based-plans/)
说明团队 Credit balance 位于 Usage & billing；免费额度用尽后可等待下一计费周期或升级。
[官方 credits 说明](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/)
说明额度按团队共享，月度 credits 在周期开始时恢复。上述是一般规则，不代表已核实本账号套餐、账单或确切余额。

主线程若继续只读检查，应从已登录控制台的 Usage & billing 核实明确的余额/周期展示；未有准确事实前不要承诺恢复日期。
恢复额度后仍需确认最新目标 commit 的 GitHub CI 成功、Netlify 构建/发布精确匹配，才可报告更新上线。

## 操作边界

本轮只读调用3个站点 API 与本地 `api --help`，读取已缓存官方 schema、仓库 TOML，并查看官方网页；未安装包、未访问真实业务数据库、未外发工具调用。
后续主线程明确要求不再提供或尝试触发构建命令，因此未调用 createSiteBuild，也未用手工上传绕开 Git 云构建。
生产数据备份、迁移对账、单主切流、稳定观察与 Zeabur 退役均不由本报告签收。
