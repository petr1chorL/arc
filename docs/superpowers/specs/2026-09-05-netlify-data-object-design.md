# 04C Data Object 生命周期迁移设计

状态：用户已于 2026-09-05 回复“确认”；批准本地五接口方案，尚未完成实现或生产迁移。
依据同目录 `2026-09-05-netlify-data-object-contract.md` 和已确认迁移总范围。

## 第一性原理与范围

目标是持久化节点交换的数据定义，允许编辑草稿、发布不可变版本，并在刷新后查看旧 Schema。
只迁移已有四条治理路由会遗漏原验收的历史读取，因此建议补一条最小只读接口。
不增加执行引擎、Schema 标准解释器、自动数据清洗、真实数据迁移或生产切流。

## 请求与兼容边界

共同前缀 `/api/workspaces/{workspace_id}/data-objects`。

| 路由 | 权限 | 成功状态 |
|---|---|---|
| GET 根路径 | asset.read | 200 |
| POST 根路径 | agent.write | 201 |
| PATCH /{id} | agent.write | 200 |
| POST /{id}/publish | agent.write | 201 |
| 新增 GET /{id}/versions | asset.read | 200 |

新增版本列表先确认定义存在且属于当前 Workspace，再返回该定义的同空间版本，created_at 倒序。
每项沿用现有 DataObjectVersionRead：id、definitionId、version、snapshot、createdAt。
无需新增单条定义 GET，现有列表提供页面编辑上下文；没有删除、停用或执行接口。

- 创建保持 name/description/schema 字段、长度、别名及 extra=forbid；Schema 仅须为 JSON object，空对象允许。
- PATCH 保持缺省与 null 均跳过，但更新时间和成功审计仍更新，不套用 Agent 的 null 拒绝规则。
- 发布保持 agent.write 权限和现有计数版本算法，快照在更新定义状态/版本之前生成。
- 名称唯一竞争映射为 409；同定义写入持有行锁；候选版本号已存在则 409，不改写或重新编号历史。
- 校验错误统一固定 422，不回显原请求；非法历史快照结构或非对象 Schema 固定 409，不自动改写。
  Schema 和 description 是用户内容，不宣称通用 DLP，也不任意删除合法 Schema 属性。
- 不存在/跨空间定义返回 404；Session/CSRF、角色与拒绝审计复用既有身份层。

## 持久化与页面

- 复用现有 definitions/versions 表和已发布 baseline，不修改旧 migration。
- 编辑/发布锁定定义行；定义、版本和成功审计同事务，失败无半版本或成功状态。
- DataObjects 页面卡片增加历史版本入口，展示版本号、时间及只读 Schema JSON。
  修改草稿后重新加载历史仍读取数据库，不缓存当前草稿冒充旧快照。
- 历史加载错误显式显示并允许重试；发布成功刷新定义和版本，失败不提前更新版本号。
- 统一迁移模式继续包含身份、依赖资产、Agent；未迁移执行入口保持阻断。
- 新 Data Object Function 保持休眠，直接 Function URL 在访问环境或数据库前返回 404。

## 需验证的验收与对抗路径

1. Python/TS 同批实际请求重放：原四路由加新版本 GET、别名、缺省/null、额外字段、固定错误。
2. 四角色五路由、CSRF、跨 Workspace、失效成员，拒绝不留下业务写入。
3. 两个独立 Session 并发发布、唯一名称竞争、候选版本冲突、审计故障全事务回滚。
4. 独立连接比较发布前后快照；编辑草稿不改变旧 Schema，新版本反映新 Schema。
5. 同库浏览器创建→发布→修改草稿→发布第二版→刷新读取两版 Schema；无旧服务/外域请求。
6. 全量后端/前端、身份/资产/Agent PG、浏览器、lint/build/deploy:check；最终对抗审查后再标工程完成。

## 建议确认

采用以上五路由方案：新增只读历史版本列表和页面入口，保留 JSON object 登记边界及 PATCH null 语义，
收紧错误回显并保护事务。不选择仅复制四路由，因为无法满足原验收；不扩展完整 JSON Schema 引擎，
因为它属于后续运行语义，不是本次治理迁移的必要前提。

确认仅针对本地实现设计，不包含生产发布、真实数据修改或关闭 Zeabur。
