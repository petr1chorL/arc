# 旧执行控制过渡契约回执

日期：2026-09-06。范围：已明确的旧 Worker 退役与 Run 删除诊断契约。
**删除成功能力仍未迁移，本回执不能计作五条旧接口功能等价完成。**

## 设计决定与边界

依据同日 runtime-legacy-control-compat 设计/计划及主线程明确确认。
旧 Python Run 删除级联销毁关联人审/产出物/黄金样本；新原生账本与并发逻辑引用不能直接套用。
没有新建 soft-delete schema、修改列表查询或所有引用写入锁规约的授权，本切片不扩大这些范围。

- POST `/execution-jobs/next`：Session、CSRF、Workspace、run.execute 后返回 410，明确异步执行器接管。
  写入 `execution_job.process_next` denied 审计；不领取、创建或执行任务。
- DELETE `/runs/{id}`：保持以上共享鉴权，缺失/跨 Workspace 404；既存 Run 全部 409，正文明确
  “运行删除能力尚未迁移……本次未删除或取消运行”。写入 `run.delete` denied 审计，保留原状态。
- 终态、未终态、待核对及持久副作用一律保留；不是把删除当取消，也不把拒绝当204成功。

## 文件

- `netlify/functions/_shared/runtime/handler.ts`：两个精确旧路由。
- `netlify/functions/_shared/runtime/postgres.ts`：复用 shared authorization，拒绝审计使用 commitOnError 保存。
- `netlify/functions/_shared/runtime/run-delete.ts`：只 SELECT 当前 Workspace Run，形成未迁移诊断。
- `scripts/runtime-legacy-control.test.mjs`：真实隔离 PG 与既有 HTTP backend 验证；复用身份 fixture 时
  同时执行原 `runtime-http.test.mjs` 的一个回归测试。

## 新验证

- RED：两个新增路由先得到404，期望未登录401；1 existing passed / 2 new failed。
- GREEN：3 passed / 0 failed，1.55s；包括原 runtime HTTP、旧领取退役、Run 删除拒绝。
- Run 删除测试覆盖未登录、CSRF、Origin、viewer 权限、缺失及跨 Workspace；operator 对完成、活动、
  待核对运行均409。完整比较 Run、Operation、uncertain effect、checkpoint 前后相等；拒绝审计持久化。
- 全域 composition 定向回归：6 passed / 0 failed，31ms。
- `npm run lint`：pass。
- `git diff --check`：pass。
- `npm run build`：pass（TypeScript、Netlify typecheck、292 modules；已有大 bundle 提醒）。

仅使用主线程提供的 loopback55433、随机 schema 合成库；每次测试 finally 自清理随机 schema。
未停止容器、提交推送、修改公开 Function、netlify.toml、前端模式或生产数据。

## 对抗式审查

- 鉴权在迁移说明前，不泄露不存在/其他 Workspace 的运行；客户端不能通过跳过 CSRF 调用旧控制面。
- 410/409 通过 ApiError 保留正常脱敏 JSON；只有明确记录的拒绝审计与共享 Session 时间会提交。
- run-delete helper 无业务 INSERT/UPDATE/DELETE，不能遗留部分级联删除。
- 已删除能力尚未交付的事实须继续留在生产切流缺口中，后续需明确引用所有权/保留方案再做真正受控删除。
