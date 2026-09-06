# HTTP Tool 202 整合验证回执

日期：2026-09-06。Tool 切片本地工程 ready-for-human；不是生产迁移完成报告。

## 实现与第一性原理

独立测试需要自己的固定请求、受理身份、外部意图和持久结果，不需要伪造 Agent/Run。
按已确认设计新增 tool.test，Operation ID 一对一关联 Invocation 和新前向快照表。
受理事务写入快照、调用记录、唤醒 outbox、审计；执行只在异步消费者进行。
共享 HTTP transport 仍保留 Agent 的 `{input}`，独立测试 POST 发送 parameters 对象。
Tool Workspace/host 白名单与模型 SecretRef 白名单分离；不新增密钥读取或 MCP 执行。

## 新验证

- 原生运行时完整入口：22 个程序通过，包括受理原子性、幂等、真实 PostgreSQL 锁竞争、
  停用、取消、晚到 receipt、未知结果核对、权限、历史隔离、配置与受控传输。
  后续空输出修复后定向 transport/lifecycle 11 项、既有 Agent Tool 29 检查重新通过。
- 主线程实际使用已安装 Python/httpx 离线对照 GET 布尔、null、平面数组、嵌套对象/数组和转义值。
  JSON 数值采用语义规范化（如 1.0 发送为 1），不声称所有数字词法与 Python 逐字节相同。
- 相关前端及 runner 边界：6 文件 33 项通过；包括跨 Workspace/卸载后的迟到响应、202 非完成、
  原生正文隐藏、kind-aware 控制，以及同页响应丢失后复用同一个提交 key。
- 本地 Chromium 完整 7 场景通过（52.5s）。最终修复后 Tool 两场景再次通过（21.1s），
  明确验证刷新后恢复 completed、没有新增 Run、Operator 不能越权、人工确认后才重新发送。
  所有外部模型/Tool/通知为受控合成发送器，外网调用为 0，不是生产模型或通知验收。
- 最终 lint、build（前端及 Netlify 类型）、deploy:check、diff check 通过；保留既有大 bundle 提示。
- 全量前端无分片运行出现持续 CPU/约 3.2 GB 内存占用且未返回结果，已停止本次已知测试进程，
  不是成功。随后采用仓库 CI 的 8 分片完整集合，结果待下方追加；没有排除测试或降低断言。

### 前端完整集合后续结果

按现有 CI 的默认 forks、单 worker、8 分片配置，70 个文件最终均取得通过证据：
主线程第1/2片通过，第4–8片连续退出0；独立诊断者第3片9文件120项通过（21.99s）。
第3片过程中发现旧 reference-assets 路由测试仍要求 Tool 测试不可达，已更新为批准的 POST
受理，并保留错误方法、Provider 路径和额外路径拒绝；该文件25项定向通过。
这不是一次无失败、不中断的全量执行：无分片及第3片曾卡住；有界重放时也有卡住和通过。
最后完成的 reporter 用例不能等同根因；仅发现 Observability URL/state 双向同步等候选，
尚无确定性根因或修复证据，不能归因“环境抖动”，也不能宣称稳定性问题已消失。
Tool 本身的接口、事务、页面与浏览器证据不替代此残留可靠性问题或生产观察。

本次临时容器 arc-one-native-host-verify-20260906 随机 schema 已确认为空，随后停止并自动移除。
只删除本次合成环境，未触碰其他容器、业务数据或用户原有两份研究文档。

## 对抗式审查与关闭

独立 Spec 审查发现受理响应丢失后页面换 key，已先得到真实 UUID 不同 RED，再修为同页同 actor、
同参数复用 key；确认响应后才清除。页面明确刷新后再次测试属于新提交，先检查历史，不宣称 exactly-once。
独立 Standards 发现空正文误报成功；transport 与持久 Operation 两层先 RED，再修为
needs_reconciliation，重复消费不重发。3xx/5xx 退出时也取消未消费的响应流。
两轴复审均无未关闭严重问题，详见 tool-test-spec-review.md 和 tool-test-standards-review.md。

## 不包含的能力与数据边界

快照通过应用只插入、不提供修改接口；未声称数据库角色层强制不可变。
新表 runtime_tool_test_snapshots 属于目标原生账本；后续目标备份/对账必须纳入它，
不能把这张源系统不存在的表加进旧 Python 源库 43 表盘点，否则会制造错误缺表结论。
尚未执行生产源库导出、恢复、对账、任务迁移、公开 API/AWL/调度启用、真实渠道验收、切流或退役。
Run 成功删除契约仍未迁移。未购买 Zeabur 方案、未取消真实任务、未关闭任何生产资源。
