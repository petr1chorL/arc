# 源库只读盘点设计

底层目标是为已授权迁移获得可信的源表数量与任务状态，不用空表或缺表冒充无数据。
本工具不连接生产、不读取连接配置、用户内容或凭证，也不执行导出、冻结、删除或迁移。

## 最小方案

- 纯 PostgreSQL SQL，由操作员使用已选定 ARC 数据库/schema 的现有会话执行。
- REPEATABLE READ + READ ONLY 同一快照；15秒statement、1秒lock timeout；最后ROLLBACK结束只读事务。
- 固定43张基线ARC表白名单；当前schema缺任何表或关键状态列立即失败，不搜索其他数据库或schema。
- 精确行数、workflow_runs/node_runs/execution_jobs/human_tasks/resume_requests/notification_outbox
  状态计数与保守未终态计数；未知状态计入未终态。失败状态另外保留在分布中，不因任务终态而认作无需处理。
- 仅全部检查完成后输出带明确成功标识的JSON NOTICE；缺表、列、权限、锁或超时不返回假零。
- 不读取用户行内容、邮箱、hash、payload、输入输出、Provider配置或任何Secret标签/值。

## 验证

先建立脚本缺失RED，再用随机schema合成数据库检查精确计数/未知状态/输出无正文标记；
空schema、缺列、阻塞锁失败；向同一只读事务插入测试写语句必须25006拒绝。
成功输出仅证明某时刻只读快照，不是生产盘点、备份、冻结、对账、任务转换或切流完成。
