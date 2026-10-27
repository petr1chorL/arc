# Netlify 全新启用现场回执

日期：2026-10-27。用户明确授权当前权限下继续；不迁历史数据，真实模型验收总费用上限人民币1元，超出前先询问，业务验收通过后才关闭Zeabur。

## 第一性原理与边界

先启用空模型绑定的新身份/API，证明新平台可用，再进行受预算约束的模型与业务闭环。空绑定不允许模型外呼；不读取密码/Key、不重设用户密码、不清空目标库。健康成功不是登录、异步运行或人审闭环成功。

## 本轮操作

- 官方CLI status成功，项目ID为0ba326b9-88aa-4df4-8fab-daa2ae5894b7。
- Production保存ARC_NATIVE_RUNTIME_CONFIG={"bindings":[]}、ARC_FRESH_START=enabled、ARC_NATIVE_MODE=runtime、VITE_ARC_ONE_MIGRATION_MODE=runtime、VITE_ARC_ONE_API_BASE_PATH=/native-api。
- 用户已报告安全配置初始密码及普通按量计费Qwen Key；执行者未读取或输出其值。
- 官方Git云构建6ae0448b6157818288e07ea4已ready/published，提交62e690957494d48c424a187ffc75e63f4b387446，发布时间2026-10-27T06:29:16.797Z（北京时间14:29）。精确提交CI40456954994为success。
- 构建期间旧版本/native-api/health与/native-api/auth/session均404，明确原生模式未启用。
- 发布后/native-api/health为200且backend=netlify-native，经过初始化标记与真实数据库门禁；匿名session与workspaces为401，外部Origin登录请求403。
- 独立干净浏览器访问生产站点正常跳转/login，页面无JavaScript异常，使用/native-api/auth/session；用户随后确认本人已成功登录。未读取密码或复制其会话。
- 用户本轮截图进一步显示已登录侧栏，要求隐藏Data Object、质量运营、通知Outbox、通知渠道；具体变更见2026-10-27-hide-secondary-navigation.md。
- 官方请求日志接口本轮返回Transport closed，未取得运行日志证据，不能据此声称零错误。

## 2026-10-27 后续验收推进

- 用户已确认模型资产“Qwen 验收”创建后刷新保留，并确认“启用验收”Agent版本已发布；均为用户界面验收证据，尚未调用模型。
- 初始账号成功后已将Production的ARC_FRESH_START设置disabled，待下次发布生效；未删除或重设账号密码。
- 官方边缘请求日志一次成功返回启用后至查询时间的HTTP 5xx列表为空；仅限该请求窗口，不覆盖后台Function或完整业务。细项POST日志查询再次Transport closed，未获得相应日志。
- 导航9755295的CI40462163849失败：Data Object旧E2E仍要求可见导航（8通过/1失败）。54e5bc5已将该断言改为导航隐藏后用原深链继续完整业务测试，两轴增量复审无严重问题；不能跳过CI声称已上线。
- 预算代码6eec71f与上述修正合并在54e5bc5，当前等待CI40463598877；生产仍空模型绑定。后续须确认新表迁移/精确发布，才启用受限profile。
- CI40463598877后续结果为cancelled：官方注释明确超过20分钟作业总时限。日志确认预算PG并发测试通过，9项资产浏览器和7项运行浏览器全部通过；取消发生在7项运行浏览器完成时，后续lint/build门禁未走完，不能算总体成功。
- 本轮浏览器环境安装阶段耗时约6分钟，单作业20分钟不足以覆盖完整检查；只调整CI总时限为30分钟，保留全部测试、断言和精确SHA发布门禁。此修改不改变业务运行超时或模型请求次数，等待新CI证明。
- 用户另已确认基础工作流发布、当前账号Reviewer绑定、单维度LLM Judge量规发布；尚未运行真实任务。

## 未完成

持久异步运行、人审/评估/通知/调度、模型预算控制与实际调用、稳定观察、移除旧代理、Zeabur停用及停用后复验。用户已创建模型资产并发布Agent，但生产模型绑定仍为空。

## 对抗式检查

不把HTTP202、合成测试、页面可打开或健康200当作业务完成；没有模型调用，不将costConfigured=false显示的零成本当作实际账单。Zeabur仍未停用。
