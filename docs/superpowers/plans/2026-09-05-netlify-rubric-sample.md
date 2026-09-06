# 04D 实施计划（用户已确认）

依据 `../specs/2026-09-05-netlify-rubric-sample-design.md`；用户已回复“接受”，允许按该设计本地实施。

1. Python契约与失败边界：扩展 `test_rubric_migration_contract.py`，新增样本隔离/幂等测试；
   先复现历史读取异常、审计失败和竞态，再局部修改 `main.py`/`human_tasks.py`，不改运行链。
2. 量规TS切片：新增 `_shared/rubrics/` 路由、校验、事务后端，复用身份与Provider策略；
   从创建读取的RED推进到完整替换、发布、历史和停用，每步共享请求比较。
3. 样本TS切片：新增 `_shared/feedback-candidates/` 三路由，构造完整合成来源链；
   保留专家资格、两唯一约束与human-task审计，验证每个失败无写入。
4. 真PG：新增独立脚本，固定loopback随机schema；有控制门的竞争与独立SQL对账；
   清理限本次schema，不安装依赖、不接生产，不使用Promise.all成功结果替代实际阻塞证明。
5. 前端：扩展统一迁移模式、Evaluations与独立候选治理区域；先UI行为测试，
   再接入隔离服务与浏览器；不加载未迁移任务/运行，不新增生产API路径。
6. 验收：相关测试→全量→lint/build→各域PG/浏览器→双轴复审；更新Issue/回执/overview。
   记录首次RED和实际命令、版本、进程终态；不以规划、mock或本地数据代替生产验收。

当前已完成契约盘点及9项既有行为验证；04D Issue进入ready-for-agent，尚未完成新后端实现。
