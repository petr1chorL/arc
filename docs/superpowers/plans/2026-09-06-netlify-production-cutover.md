# 生产切流实施计划

依据同日 production-cutover-design；用户授权完成 5、6。

1. 将已验收的 04A–06 基线提交/推送迁移分支，核对远端完整 SHA、CI verify 与 Netlify 部署。
2. `netlify/functions/_shared/native/`：先测全域路由组合/关闭门禁/配置绑定，再装配既有模块；
   `scripts/native-deployment.test.mjs` 保证关闭时不访问数据库或 Secret，不修改当前生产 `/api` 代理。
3. `netlify/functions/_shared/native-compat/` 与对应测试：补已确认旧接口兼容和明确 Worker 退役响应，
   保持固定版本、权限、Workspace、审计和未知副作用限制。
4. 以实际已登录平台盘点生产资源和备份入口，形成独立备份、恢复和对账脚本；未获取源库状态前不写“无需转换”。
5. 经隔离 Preview 完整云端验收后才冻结/迁移/对账/切流；记录回滚前后版本和单主边界。
6. 观察实际业务和投递状态，达到记录的门槛后关闭 Zeabur，再验证 Netlify；无观察证据不得完成 08。

独立只读 readiness 已完成；实现与发布分离。任何新配置/数据处置判断必须以可审查事实说明，
不能因用户要求持续推进而取消备份或将本地合成测试写成线上验收。
