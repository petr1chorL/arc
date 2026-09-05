# 验证回执（工程与 Preview 验证通过，生产未发布）

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
- 工程验证阶段未创建 PR；后续 Preview PR #39 见下节。未合入 `codex/harness-governance`、未切换 Production API 或停用 Zeabur。
- CI 完成后以公开 GitHub API 对同一完整 SHA 重跑门禁，真实放行 run 33928026353；
  CI 未完成时的拒绝与成功后的放行均已验证。
- 上述工程阶段未执行 Netlify 部署；随后文档提交 cc98029 的独立 Preview 已完成下节验收。
- ba35010 与 cc98029 的验证版本分别记录；今后的提交仍必须等待自身精确 SHA 的 CI，不能继承旧提交放行结果。

## 2026-09-05 隔离 Preview 验收

- [PR #39](https://github.com/petr1chorL/arc/pull/39) 保持 OPEN；head 为
  `cc98029676a7b0ecf3df95124a2e853dba9fdb55`。
- 精确 push [CI 33929272335](https://github.com/petr1chorL/arc/actions/runs/33929272335)
  与 PR [CI 33929817681](https://github.com/petr1chorL/arc/actions/runs/33929817681) 均 success。
- [Netlify Deploy 6a9b54d034fa00000853068e](https://app.netlify.com/projects/arc-one-agentic-os/deploys/6a9b54d034fa00000853068e)
  为 `ready`、`deploy-preview`，commit_ref 与上述完整 SHA 一致。
- 云端 Building 日志第 96–97 行实际记录执行
  `node scripts/verify-ci-release.mjs && npm run build`，随后输出
  `Release gate passed: CI run 33929272335, commit cc98029676a7b0ecf3df95124a2e853dba9fdb55`。
  这是成功提交的真实云端放行证据；未额外制造失败提交触发云端拒绝，失败关闭证据仍为既有测试及真实 GitHub API 拒绝。
- 数据库建立 `codex/identity-release-hardening` Preview 分支，平台记录没有新 migration 应用。
  本轮未写入合成或真实业务数据，也未再次用写入标记检验数据库隔离。
- 以下无凭证 GET 均针对[不可变部署地址](https://6a9b54d034fa00000853068e--arc-one-agentic-os.netlify.app/login)：

| 检查 | 结果 |
|---|---|
| `/login` | 200，HTML |
| `/assets/index-CKxez5rl.js`、`/assets/index-DHuXV5Xc.css` | 均 200，正确资源类型，分别 755288 / 180959 字节 |
| `/api/health` | 200，`{"status":"ok"}`；该路由仍代理 Zeabur |
| `/api/auth/session` | 401，未登录或会话已失效 |
| `/.netlify/functions/identity-workspace?route=/api/auth/session` | 404，JSON `{"detail":"Not Found"}`，不是 SPA 回退 |
| `/.netlify/functions/platform-health` | 200，`{"status":"ok","database":"ready"}`；只读健康检查 |
| 浏览器 `/login` | 登录表单正常渲染，截图无布局异常，捕获的 error/warn 日志为空 |

- 未提交登录表单、未调用探针触发器、未执行身份业务写入；该页面验证不能替代新身份 Function 的真实登录验收。
- 验收后站点 reader 确认 Production 仍为 `6a9a97898a5f2300089163e3` / `ready`；
  生产分支未合入，`/api/*` 仍代理 Zeabur。未执行生产回滚或 Zeabur 停机。
- 本节是对已部署 cc98029 的验收回执，不把后续文档变更冒称为已部署版本。

## 结论

工程与独立 Preview 发布门禁验收通过，Issue 保持 ready-for-human；当前生产服务没有更新。
下一可执行步骤是生产合入准备与 04A 引用资产契约细化；PR #39 不自动合并。
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
