# 源库只读盘点工具回执

2026-09-06；工具 local-pass，**未连接生产、未完成生产盘点**。

## 交付与准确范围

`scripts/cutover-source-inventory.sql` 只检查当前已选定schema的43张ARC基线物理表；输出表行数及
workflow_runs、node_runs、execution_jobs、human_tasks、resume_requests、notification_outbox 六类状态计数。
输出数据库名、schema、serverVersion、快照时间、readOnly/isolation；不输出逐行业务内容、身份字段、
邮箱、密码哈希、输入输出、payload、Provider配置、SecretRef或Secret值。

每类状态输出 knownTerminalStates、nonterminal 和完整 statusCounts。未知/NULL状态保守计入未终态。
已确认失败可以是终态，**nonterminal=0不表示没有待处理失败、更不表示可以直接切流或关闭Zeabur**。
43只表示基线表白名单，不是当前数据库所有表数量；原生附加表及其他应用的表不在此工具扫描范围。

## 运行方式（生产尚未执行）

1. 操作员用既有授权方法连接**明确选定的ARC源库**；不得把连接密码粘入脚本或输出。
2. 使用新的空闲会话，确认目标数据库/schema。默认选中schema应为ARC表所在schema；不要在已有业务事务里运行。
3. 在该会话执行整个SQL文件。若是已登录psql会话，可用：

   ```text
   \set ON_ERROR_STOP on
   \i 'D:/project/安克知识沉淀/scripts/cutover-source-inventory.sql'
   ```

   路径是本工作区文件；远程控制台需将文件作为SQL输入，不是让远程主机寻找本地路径。
4. 只有得到一条 `NOTICE: ARC_SOURCE_INVENTORY { ... }` 且脚本末尾事务结束，才视为本次快照检查完成。
   缺表/列、权限不足、RLS当前会话过滤、锁或statement超时必须按失败处理，不用部分结果假装成功。
5. 如果客户端因ON_ERROR_STOP停在失败事务，执行`ROLLBACK;`再退出；不得去掉只读或加写权限来绕过异常。

## 只读与时间边界

READ ONLY + REPEATABLE READ，statement_timeout15s、lock_timeout1s、idle事务20s；末尾ROLLBACK。
只有最后完整成功时输出汇总，不生成导出文件、不冻写、不停服务、不修改原库。
若数据量超过15秒扫描预算，应记录超时并设计有界分段方案，不将其改成无限等待或假零。

## 本轮新证据

- 设计/计划/07c Issue先于实现；RED为SQL文件不存在ENOENT。
- `ARC_RUNTIME_TEST_PORT=55433` + `node scripts/cutover-source-inventory.test.mjs`：3 passed，1.71s。
- 合成快照3条Run，完成1/待审核1/未知1，精确返回总数3、未终态2、43表；正文标记未出现在输出。
- 向同一只读事务加入测试INSERT，被PostgreSQL以25006拒绝；原数据保留。
- 无ARC表及缺status列明确失败；独占锁阻塞时55P03有界失败，且没有成功NOTICE。
- lint、git diff --check通过。此次纯SQL/Node工具未改变应用构建输入，未重复全前端构建。
- 测试仅用随机schema且finally清理，未停共享合成容器；没有真实生产连接/env读取或新包。

## 对抗式边界

工具不会判断“生产空库”、不会决定是否丢弃/取消任务，也不执行备份、恢复、迁移、增量、对账、
冻结或切流。真实运行需精确目标的生产连接稳定后由主线程授权流程执行并独立保存证据。
