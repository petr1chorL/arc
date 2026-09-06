# 资产历史验证库：同步当前结构迁移

状态：按用户持续修复/验收授权执行；只改合成测试设施，不改生产数据库或历史查询策略。

第一性原理：测试当前原生查询必须使用当前结构；基线表不能代表后续Operation/Tool关联表已存在。
CI 34025942754 的 reference-assets invocation history 返回503；同命令本地确定RED，
专属PG日志确认 `relation "runtime_operations" does not exist`。旧fixture只执行baseline/rate-limit。

计划：从 runtime-test-db.mjs 既有排序/排除seed迁移循环抽取 applyTestMigrations，原调用改为复用；
资产PG合同脚本及资产浏览器服务复用此函数。仅改变测试结构准备，不放宽200、历史治理、权限或脱敏断言。
其他独立域的基线合同若不读取runtime保持原范围；生产入口仍关闭，生产迁移必须另行验收。

验收：原失败PG合同RED→GREEN；共享helper原生完整入口、受影响资产浏览器、lint/build/deploy:check通过；
独立复审确认未吞缺表异常、未跳过合同断言、未读取生产配置或执行preview身份seed；清理专属合成容器。
本次修复只纠正测试设施依赖，不证明生产已具备这些表，也不消除Netlify账户额度和源备份权限阻断。
