# 04B 实施计划

依据已确认 `../specs/2026-09-05-netlify-agent-lifecycle-design.md`。只实现八条治理路由，不迁移执行接口。

## 1. Python 目标契约

- `apps/api/tests/test_agent_lifecycle_api.py`：先断言正常发布/停用状态失败，再改 `app/main.py` 对应写入；
  增加两种停用值的编辑/发布保护与历史快照不变断言。
- 新增 `apps/api/tests/test_agent_migration_security.py`：逐一覆盖非空字段 null 固定 422、缺省不改、Provider null 合法解绑。
  修正 `app/schemas.py` AgentUpdate 校验及 `app/reference_asset_http.py` 的 Agent 校验错误脱敏分支。
- `app/agent_manifest.py` 与 `schemas.py` 使用既有安全 URL 策略；新写入及历史读取各自测试 422/409。
  历史检查放入独立 `app/agent_registration_policy.py`，路由只调用边界，不扩大 main.py 重构。
- 先运行单个测试的 RED，再最小修复及相关文件回归；全量验证前保留每次失败证据。
- 最终审查补充：Python 同步保护候选版本冲突和 Agent 治理写行锁；用
  `scripts/test-agents-python-postgres.py` 观察实际 PG 阻塞及历史快照不变。
  Provider/Tool/Skill 的同事务依赖锁已补齐，并在同一 Python PG 脚本分别观察 SQL 停用写入阻塞；
  该证据不替代完整 HTTP 停用路径验证，也不把 TS 锁证据用于证明 Python。

## 2. Netlify 端到端最小切片

- 新建 `netlify/functions/_shared/agents/{routes,handler,policy,postgres}.ts`，复用身份的请求和事务执行器。
- 从创建/读取开始，`scripts/agents.test.mjs` 先覆盖八条路由及未迁移执行拒绝。
- `fixtures/agent-requests.json` 与 `scripts/agent-contract-python.py` 保存同样合成请求；只归一化随机 ID 和时间。
- `scripts/test-agents-postgres.mjs` 使用已存在 loopback 55432、随机 schema 和合成身份；
  沿用 04A 的本地配置，不接生产库或自动安装依赖。
- 逐次实现 PATCH/绑定/解绑、版本列表、发布、停用、恢复；Agent 行锁和依赖固定顺序锁保护事务。
  测试并发发布、发布与依赖停用竞争、审计故障回滚、跨空间引用与异常历史。
- 新 `netlify/functions/agents.mts` 保持休眠，不增加生产路径；直接 Function URL 404。

## 3. 页面闭环与工程验收

- `src/api/migrationCapabilities.ts` 扩展统一治理模式，复用现有单一开关。
- `src/pages/{Agents,AgentDetail}.tsx` 及测试：规范化状态计数、依赖加载失败提示、未迁移运行入口双重阻断。
- 扩展现有隔离服务器和 Playwright 配置，新增 `e2e/agent-lifecycle.spec.ts`。
  登录→创建→绑定→发布→改草稿→刷新读旧版本→停用→恢复，无外域/旧 API 请求。
- 相关门禁先行，再执行 `python -m pytest apps/api/tests -q`、`npm test -- --run --maxWorkers=2`、
  `npm run lint`、`npm run build`、`npm run deploy:check`、身份/04A/Agent PG 与浏览器回归。
  Windows 使用 `apps/api/.venv/Scripts/python.exe` 和每轮全新 `.scratch/` 测试目录。
- `.github/workflows/ci.yml` 加 Agent PG/浏览器门禁；记录本地证据，不假称远程 CI 已运行。
- 对抗审查围绕状态保护、空值/凭证回显、引用竞态、快照不变、错误完成感；更新 Issue、overview 和回执。

所有新增文件遵守当前仓库规范，已有未提交改动与 `.harness/wiki/research/` 保留；不自动提交、部署或关闭 Zeabur。
