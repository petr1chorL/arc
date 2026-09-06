# 观测页导航收敛与详情隔离：验证回执

日期：2026-09-06。本地工程 ready-for-human，不代表生产发布或迁移验收完成。

## 改动与对抗检查

按已确认设计移除 selectedRunId 镜像状态，仅从有效可见 URL 派生选择；保留缺失/无效 URL
的默认风险运行规范化，点击只写 URL。详情 effect 在新选择时清旧数据，并通过 cleanup
隔离旧请求的成功、失败与 finally。不改权限、后端、数据库、生产代理、租约或运行状态。
既有测试的9个纯数据常量原样抽取至共享fixture，不删除旧测试或放宽超时。

独立诊断先确定导航交错 RED（21次回写护栏，349ms），再确定旧详情晚到 RED（209ms）；
主线程也观察到旧正文覆盖新选择的失败。修复后独立复核新2例及原12例，14/14 PASS。
Spec/状态一致性、URL兼容、异步失败边界复审0阻断，见 observability-navigation-review.md。
仅证实并修复两条明确缺陷，不声称取得历史长时间卡死的同一CPU栈或排除全部其他来源。

## 主线程新证据

- 曾异常的真实 `--shard=3/8`：9文件120项 PASS，14.98s。
- 随后完整8分片一次连续结束、退出码0：**71文件696项 PASS**。
  各分片测试数为34、62、120、141、60、87、103、89；无中途重启或改pool。
- `npm run lint`、`npm run build`（含前端与Netlify类型检查）PASS；保留既有bundle大小提示。
- 本地Chromium完整运行闭环及Tool测试：**7场景 PASS，51.6s**，包括实际观测页读取持久Trace。
  主线程检查了 `test-results/runtime-closure-native-art-6b597-aces-without-browser-errors/native-trace-observability.png`。
- 所有数据库/模型/Tool/通知为一次性合成设施，浏览器仅访问loopback；不是生产模型或真实通知验收。
- 专属 `arc-one-observability-verify-20260906` 使用已缓存PG17镜像，端口仅绑定127.0.0.1:55433；
  测试后查询非系统schema为空，停止并由--rm移除。未动其他容器/真实数据。

## 云端边界

本地Netlify CLI已验证现有登录及ARC站点关联。API确认GitHub仓库/分支正确、stop_builds=false。
最近四个push均触发Netlify但因 `Skipped due to account credit usage exceeded` 被跳过；
不是Git持久连接失效。最后发布仍是b626602；不反复trigger、绕过CI门禁或擅自购买额度。
生产源库访问/备份恢复、任务对账、公开运行宿主接线、隔离云端验收、切流/回滚和稳定观察仍未完成。
