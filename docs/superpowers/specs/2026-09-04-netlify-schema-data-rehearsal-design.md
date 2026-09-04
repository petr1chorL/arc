# Netlify Schema Baseline 与数据演练设计

## 决策

以 `apps/api/app/models.py` 的 `Base.metadata` 作为当前结构事实源，使用 SQLAlchemy PostgreSQL
dialect 生成确定性 baseline。baseline 只复制当前表、列、主键、唯一约束和索引，不加入业务
重构或源模型没有声明的物理 ForeignKey。

## 已确认基线

- 43 张业务表。
- 524 个字段。
- 112 个索引。
- 26 个 UniqueConstraint。
- 0 个物理 ForeignKey。

物理 ForeignKey 为 0 是当前实现事实，不是迁移遗漏。本切片额外检查 Organization、User、
Workspace、Membership、Workflow Run 和 Execution Job 之间的代表性逻辑引用，避免用“没有
约束错误”伪装数据一致。

## Baseline 生成

- 新增 Python 生成模块，按表名和索引名稳定排序并使用 PostgreSQL dialect 编译 DDL。
- 生成结果作为 Netlify Database 向前 migration 提交。
- 聚焦测试把 migration 字节内容与生成结果对比；模型变化但 baseline 未更新时测试失败。
- migration 禁止 `DROP`、`TRUNCATE`、`DELETE`，不包含连接串或数据正文。

## 非生产演练

- 只使用固定 ID、固定时间和虚构域名组成的合成快照。
- Preview 专用 migration 导入 Organization、User、Workspace、Membership、Workflow Run 和
  Execution Job 各一条记录；其余业务表保持 0 行并纳入表存在性核对。
- Preview 专用只读 Function 只在 `context.deploy.context == deploy-preview` 时响应，返回表存在性、
  行数、主键摘要、逻辑引用违规数、状态分布和 Run 数值汇总，不返回记录正文。
- 本地期望清单与线上摘要逐项比较；重复请求不会写数据。

## 生命周期与发布

1. 临时 PR 同时携带 baseline、合成数据 migration 和 Preview-only 状态 Function。
2. Netlify 创建隔离数据库分支并应用 migrations。
3. 对账全部通过后关闭 PR，删除 Preview deploy 和临时分支。
4. 只把 baseline 生成器、baseline migration、测试和长期证据提交到生产分支；不把合成数据或
   Preview 状态 Function 带入 Production。
5. Production 只新增空业务表；`/api/*` 继续代理 Zeabur。

## 失败与回滚

- baseline 失败：Preview 构建失败，Production 不受影响。
- 对账失败：不提升 baseline，删除 Preview 分支后修正生成器或映射。
- Production 空表 migration 失败：Netlify 不发布新 deploy，继续保留上一部署和 Zeabur API。
- 本切片不删除、覆盖或导入任何 Zeabur 数据。

## 安全与完成边界

日志只输出结构数量、哈希、状态计数和数值汇总。测试数据不得出现真实邮箱、密码摘要、Token、
Secret Ref、连接串或业务正文。完成本 Issue 只证明 schema 与非生产迁移演练，不证明生产数据、
API、身份、Worker 或完整业务闭环已经迁移。
