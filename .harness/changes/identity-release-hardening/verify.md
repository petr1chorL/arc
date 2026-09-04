# 验证回执（工程验证通过，生产未发布）

## 本地

- `npm test -- --run --maxWorkers=2`：53 文件、333 项通过。
- 身份聚焦：24 项通过；新增发布门禁：13 项通过。
- `npm run lint`、`npm run deploy:check`、`npm run build`、`git diff --check`：通过。
- 既有 755.28 kB JS chunk warning 保留，无 UI 范围重构。
- `apps/api/.venv/Scripts/python.exe scripts/identity-contract-python.py`：隔离 SQLite 重放通过。
- 完整后端：410 项通过（全量命令退出码 0；独立 collect-only 确认 410 项）。

## GitHub 与发布门禁

- CI run： https://github.com/petr1chorL/arc/actions/runs/33928026353
- SHA：`ba35010730b14760267800a00751c4df3bbe238d`。
- CI 整体 success；隔离 PostgreSQL 129 项检查通过，输出
  `{"postgresIdentityChecks":129,"legacyContract":"matched","concurrentAdminRemoval":"protected"}`。
- PostgreSQL 使用真实 baseline 与限流 migration，验证登录、持久化、拒绝回滚、并发
  全局 User 停用与成员降级、120 次失败请求累计预算、121 次 429 和过窗恢复。
- 旧 Python SQLite / 新 TypeScript PostgreSQL 对比包含未登录、登录会话/Workspace/成员字段、
  缺少 CSRF、跨 Workspace 全局停用状态/错误体与拒绝后 User 状态；不是全量接口穷尽差分。
- 公开 GitHub API 的单次精确 SHA 检查，在 CI 未完成时确实拒绝放行。
- 未创建 PR、未合入 `codex/harness-governance`、未切换 Production API 或停用 Zeabur。
- CI 完成后以公开 GitHub API 对同一完整 SHA 重跑门禁，真实放行 run 33928026353；
  CI 未完成时的拒绝与成功后的放行均已验证。
- 未执行 Netlify 新 Preview/Production 部署，因此不能将脚本门禁验证替代平台部署验收。
- 本回执与 CURRENT_IMPLEMENTATION 的后续提交仅更新文档；以上 CI 证据对应可执行代码提交 ba35010，
  不冒称后续文档提交的精确 SHA 已完成 CI。生产发布仍必须等待其自身 SHA 的 CI。

## 结论

工程验证通过，Issue 进入 ready-for-human；当前生产服务没有更新。
下一可执行步骤是独立 Preview 的发布门禁验收与合入准备，然后细化 04A 契约。
不在这一轮启用生产身份路由或迁移真实数据。

## 平台依据

- [Netlify build variables](https://docs.netlify.com/build/configure-builds/environment-variables/)：COMMIT_REF 是待构建提交。
- [GitHub workflow runs](https://docs.github.com/en/rest/actions/workflow-runs)：按 head_sha/event 查询公开仓库运行。
- 2026-09-05 只读确认 `petr1chorL/arc` 为公开仓库，CI workflow ID 为 `309758735`。

## 重放方式

CI 自动创建独立 `postgres:17` service，库名 `arc_identity_test`，只在 runner 本机监听。
运行 `node --experimental-transform-types scripts/test-identity-postgres.mjs`；本地已有同样
隔离数据库时，可追加 Python 可执行文件路径。工具不读取 .env，不接受远端/生产连接地址，
用随机密码和唯一 schema，测试结束删除自己的合成 schema。

Windows 测试使用虚拟环境并在导入 app 之前设置 `Settings.model_config['env_file']=None`、
`DATABASE_URL=sqlite:///:memory:`、`ENVIRONMENT=development`、空测试 Model Key。
pytest 使用新的 `.scratch/pytest-hardening-full-01` 基目录，未连接默认业务库。
沙箱的 pytest 临时目录 PermissionError / Vite spawn EPERM 已通过审批后重跑，
这些权限错误不是产品测试红灯。
