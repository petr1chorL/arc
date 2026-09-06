# 04C Data Object：现有契约与验证缺口

状态：源码盘点和旧测试补强完成，尚未实现 Netlify 迁移；不替代设计审批。
来源：`apps/api/app/main.py`、`schemas.py`、`models.py`、`src/api/dataObjects.ts`、`src/pages/DataObjects.tsx`。

## 第一性原理与实际范围

用户需要可持久化的结构定义、可变草稿、不可变版本和刷新后可追溯历史。
定义登记不是运行时内容校验，更不等于实现完整 JSON Schema 标准。
当前只有四条治理路由，共同前缀 `/api/workspaces/{workspace_id}/data-objects`：

| 方法与后缀 | 状态 | 权限 | 行为 |
|---|---|---|---|
| GET 根路径 | 200 | asset.read | 空间内定义，created_at 倒序 |
| POST 根路径 | 201 | agent.write | 创建 draft / unpublished，成功审计同事务 |
| PATCH `/{id}` | 200 | agent.write | 编辑非 null 字段，保持原发布状态和版本标签 |
| POST `/{id}/publish` | 201 | agent.write | 按已有版本数量生成版本、保存快照，再更新定义为 published |

尚无 GET 单条或 GET 历史版本接口；前端发布后只更新本地列表状态/版本，不加载历史版本。
因此不能把现有四条路由和一次发布响应当成“刷新读取历史版本”已经实现。

## 字段与失败语义

- 创建：name 1–120，strip 后非空；description 默认空，上限 2000；schema 必填 JSON object。
  接受 object_schema 字段名与 schema alias，extra=forbid。
- Schema 验证只证明 JSON object，不检查 type/properties/required 的标准语义；空对象也符合当前契约。
- PATCH 三个字段均允许 null，路由跳过 null；缺省也跳过，但更新时间和成功审计仍会写入。
  这与 Agent 的 null 行为不同，不应复用同一 PATCH 转换函数。
- 同空间名称唯一，预检查重复返回 409；模型还有唯一约束兜底，但竞争冲突映射需 PG 实证。
- 找不到或跨空间定义返回 404；发布 capability 是 agent.write，不是 agent.publish。
- 快照在更新定义 status/version 前生成，保存发布前字段；历史快照不跟随草稿更新。
- 表没有 definition_id + version 唯一约束；不能凭顺序测试宣称并发发布安全。

## 本轮证据与纠正

旧六项 API 测试最初全部通过，但其中 `test_data_object_publish_freezes_snapshot`
向未映射的 `record.schema` 赋值，并只检查旧响应对象，因此没有验证预期的 Schema 更新和数据库历史。

1. 先增加第二版本必须保存新 Schema 的断言，得到真实失败：数据库仍保存原 asin/summary Schema。
2. 仅将测试夹具写入改为实际映射字段 `record.object_schema`，未改生产实现。
3. 两条发布测试补独立 Session 读取第一、第二版本，与各自快照逐值比较。
4. 最新命令：`apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_data_object_definitions_api.py -q -o addopts='' -p no:cacheprovider --basetemp=.scratch/data-object-freeze-green-20260905 --tb=short`。
   6 passed，6.48 秒，退出 0；1 条既有 Starlette 弃用警告。

这次 RED/GREEN 是测试证据修复，不是生产版本不可变逻辑原先失败、现在修复的声明。
测试仅使用临时 SQLite；尚无 04C TS、共享请求、PG 权限/竞争/回滚或浏览器迁移证据。

## 下一设计必须解决

- 为满足原验收“刷新读取旧版本”，明确增加最小只读历史版本接口及页面入口；不得伪造既有接口。
- 保留 JSON object 登记边界或明确扩展 Schema 语义校验；扩展不能藏在迁移实现里。
- 发布锁定同一定义、版本号碰撞拒绝、唯一名称竞争与成功审计原子性需真实 PG 验证。
- 历史异常、Workspace 隔离、角色、错误回显和本地迁移模式需先写确切规格，再进入实现。
