# 07/08 生产切流与退役

Status: in-progress

用户授权完成截图 5、6。PRD 与 AC 对应 `.scratch/netlify-native-migration/issues/07-production-cutover.md`
及 `08-zeabur-decommission.md`。设计、计划见同日 production-cutover 文档。

已推送并发布修复 `b626602`，CI `34020649346` 成功；正式部署 `6a9d1d993c53f700086e848e`。
本批本地原生路由/依赖、Provider 兼容、旧控制接口安全拒绝、只读盘点工具整合通过，17 程序通过。
独立审查和准确发布状态见 `verify.md` 及各切片报告。

生产仍由 Zeabur 提供 API/Worker/数据；控制面备份要求升级且免费终端断线。
费用决定尚未答复，没有备份、迁移、单主切流、稳定观察或 Zeabur 退役结果，不得标记完成。
