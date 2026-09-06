# 04D Rubric 与 Golden Sample 契约盘点

状态：源码盘点，不是已确认设计或已实现迁移。依据 `app/main.py`、`schemas.py`、`human_tasks.py`。
所有路径前缀为 `/api/workspaces/{workspace_id}`。运行评分不在治理切片中。

## 已核实路由

| 方法与路径 | 权限/资格 | 成功与副作用 |
|---|---|---|
| GET /evaluations/rubrics | asset.read | 200；空空间会写默认量规并提交，不是纯读 |
| POST /evaluations/rubrics | rubric.write + CSRF | 201；草稿、sortOrder=max+1、成功审计同事务 |
| PATCH /evaluations/rubrics/{id} | rubric.write + CSRF | 200；使用完整 RubricWrite，不是字段级部分更新；disabled 拒绝 |
| GET /evaluations/rubrics/{id}/versions | asset.read | 200；同空间查量规再查版本，createdAt 降序 |
| POST /evaluations/rubrics/{id}/publish | rubric.publish + CSRF | 201；disabled 拒绝；更新 active/版本后才拍快照，与 Agent 顺序不同 |
| POST /evaluations/rubrics/{id}/deactivate | asset.deactivate + CSRF | 200；写 disabled 与审计 |
| GET /feedback-candidates | asset.read | 200；同空间候选列表，现有样本页面使用此路径 |
| GET /feedback-candidates/{id} | asset.read | 200；同空间候选详情，缺失404 |
| POST /feedback-candidates/{id}/confirm | 活跃用户/成员/审核人，且专家；CSRF | 201；幂等确认 Golden Sample、候选状态与人工任务审计 |

当前盘点未见独立 Golden Sample 创建/列表路由；不得据表名发明公共 API。
经现有测试与前端调用复核，范围共九条路由（首轮漏列候选列表 GET，现已补入）。

## 量规输入与持久化

- RubricWrite 禁止额外字段，支持既有别名；name/artifact/gate 去空白且非空。
- passScore 0–100；dimensions 非空、权重总和100，显式ID和名称按 casefold 判重。
  缺失维度ID在存储时生成 UUID；应在双栈对比中只归一化生成ID，不重写维度业务值。
- judgeType 为 deterministic/llm；judgeModel 去空白；Provider ID 去空白，空串变 null。
- PATCH 是完整写入契约，缺省 judgeType/judgeModel/Provider 会采用默认值；不可套用 Agent PATCH 的缺省不改规则。
- 指定 Provider 时，缺失/跨空间、disabled、配置不完整均422；不同于 Agent 的部分404行为。
  Provider 只登记引用，不解析 Secret 或调用模型。
- LLM 发布要求模型、Provider、非空维度及每维 ID/criteria/name，重复检查仍在发布路径。
- RubricRead 的 null Provider 字段会省略；版本 snapshot 为 RubricRead 投影。

## Golden Sample 必须保持的来源链

- 不允许用户任意提供 input/expectedOutput 代替来源：input 来自 WorkflowRun，expectedOutput 来自修改后的 ArtifactVersion。
- 候选、修改版本、运行和 HumanTask 必须在同 Workspace 且存在；缺失源数据拒绝。
- 当前服务先验证活跃审核资格和专家身份，再处理幂等；同幂等键但候选/审核人不同409。
  同候选已经有样本、但不是合法幂等重放时409。
- 幂等查询目前按全局键查，候选样本查询按 candidate_id 查；迁移前需要核对唯一约束及跨空间冲突输出，
  不得直接假设已具备完整隔离/并发保证。
- 成功时创建样本、更新候选已确认/confirmedAt、写 human-task 审计并提交。
  这不是普通 record_success 审计入口，不能漏迁该审计。
- 样本生成依赖已有运行与人工任务记录。隔离验证可构造完整合成来源链，但不能据此声称运行/审核生成链已迁移。

## 实施设计前待核实

1. 动态重放完整/缺省/null/别名/数值输入，输出错误不得回显敏感原值。
2. 空空间 GET 默认量规写入的并发、审计与读权限副作用如何兼容；不能悄悄移除或扩大权限。
3. 量规发布行锁、Provider依赖锁、候选版本冲突及事务审计失败回滚。
4. 样本确认幂等键/候选唯一约束、专家撤权、跨空间来源、并发确认及失败无半样本。
5. 样本页面读取路径和来源展示；确认是否已有足够读接口，不把新功能混入迁移。
6. 未迁移评分/运行入口必须在迁移模式阻断，不代理旧库处理新ID。

第一性原理：先保存可追溯的评价依据；不能把量规或样本登记成功当成评分效果可信。
下一步是动态契约证据和设计/实施计划；Issue 保持 needs-triage，尚不进入编码或生产操作。

## 本地动态证据（2026-09-05）

- 既有量规生命周期/校验/稳定维度ID/Provider隔离、人工修改候选和专家幂等确认用例：
  `test_evaluations_api.py` 与 `test_human_task_api.py` 按相关名称筛选，8 passed、30 deselected，10.85秒。
  选择表达式：`rubric_draft or rubric_validation or rubric_create or llm_rubric_publish or evaluation_rubrics or expert_confirms_feedback or only_human_modification`。
- 新增 `test_rubric_migration_contract.py`：1 passed，1.84秒；证明仅改 name 的部分 PATCH 422且无修改；
  完整 PATCH 缺省 judgeType/judgeModel/Provider 会恢复 deterministic/空模型/省略Provider，
  发布快照为 active/v1.0.0，后续改草稿与停用不改历史。
- 以上是现有 Python 合成 SQLite 行为的特征测试，不是新增行为 TDD 的 RED，也不是 TS/PG 或生产验收。
  尚未覆盖样本并发确认、故障注入、全量权限矩阵、默认量规并发播种；不能据9项通过声称04D迁移完成。
