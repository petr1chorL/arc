# 源库只读盘点实施计划

1. `scripts/cutover-source-inventory.test.mjs` 使用现有 runtimeTestDatabase，先因目标SQL不存在红测。
2. `scripts/cutover-source-inventory.sql` 实现固定表白名单、只读一致快照、有限时限和单一成功NOTICE。
3. 验证准确状态分组、未知状态保守分类、无正文泄露、无ARC表/缺列/锁超时失败，以及25006只读拒写。
4. `.harness/changes/netlify-production-cutover/source-inventory.md` 写运行方法、边界及新本地证据，
   不连接生产或把工具完成写成盘点已执行。
