# 强制执行 Workspace 隔离与固定 RBAC

Category: enhancement
Status: ready-for-agent
PRD: `../PRD.md`

## 建设内容（What to build）
提供 Workspace 创建与可访问列表，为新 Workspace 建立创建者的管理员初始成员关系；
为受保护请求建立明确的用户、组织、Workspace、成员关系和 Session 上下文。将 Agent、Workflow、Run、Human Task、Reviewer/Feedback API 迁入 Workspace 路径，并通过统一授权服务执行固定角色与完整 capability 矩阵。前端提供 Workspace 路由、切换器和 capability 驱动的命令可见性或只读状态，但后端仍是最终安全边界。

## 验收标准（Acceptance criteria）
- [ ] `GET /api/workspaces` 只列出当前用户具有有效成员关系的 Workspace；组织管理员可列出组织内 Workspace。
- [ ] `POST /api/workspaces` 仅允许组织管理员创建 Workspace，并为创建者建立有效的 `workspace_admin` 初始成员关系。
- [ ] Web URL、API 路径、数据库查询、资源归属和审计上下文使用同一 Workspace。
- [ ] Agent 创建/查询/编辑/发布/停用 API 迁入显式 Workspace 路径。
- [ ] Workflow 创建/查询/编辑/发布 API 和 Run 查询/执行/终止/重试 API 迁入显式 Workspace 路径。
- [ ] Human Task 查询 API，以及 Reviewer、Review Group、Feedback Candidate 和 Golden Sample 查询 API 迁入显式 Workspace 路径。
- [ ] 旧匿名业务 API 不作为兼容入口保留。
- [ ] 观察者、运行者、构建者和 Workspace 管理员按 PRD 完整 capability 矩阵授权。
- [ ] 组织管理员在组织内自动拥有所有 Workspace capability，但不是第五种 Workspace 角色。
- [ ] 业务路由只通过统一授权服务判断 capability，不直接比较角色字符串。
- [ ] 已登录但能力不足返回 403；Agent、Workflow、Run、Human Task、Reviewer/Feedback 路径 Workspace 查询或修改返回 404。
- [ ] Agent、Workflow、Run、Human Task、Reviewer、Review Group、Feedback Candidate 和 Golden Sample 查询与写入均受 `workspace_id` 限制。
- [ ] Workspace 创建，以及 Agent 创建/编辑/发布/停用、Workflow 创建/编辑/发布、Run 执行/终止/重试等通过授权的写操作，写入 outcome 为 `success` 且带 `workspace_id` 的审计事件。
- [ ] capability 拒绝写入 outcome 为 `denied` 且带目标 `workspace_id` 的审计事件。
- [ ] 前端 Workspace 切换会同步更新 URL 和后续请求路径。
- [ ] 前端权限状态不能替代或绕过 API 授权。

## 前置依赖（Blocked by）
- `01-authentication-session.md`
- `02-workspace-migration.md`

## 处理记录（Comments）
- 2026-06-26 Task 4 backend completed with TDD.
- RED: added `apps/api/tests/test_workspace_access_api.py`, then ran `apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_workspace_access_api.py -q` and confirmed failure before implementation.
- GREEN: implemented request context, capability authorization, workspace router, workspace-scoped business APIs, audit writes, and updated backend API tests to authenticated workspace paths.
- Verification:
  - `apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_workspace_access_api.py -q` -> 11 passed
  - `apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q` -> 103 passed
  - `apps/api/.venv/Scripts/python.exe -m compileall -q apps/api/app apps/api/tests` -> passed
  - `git diff --check` -> passed
- Scope note: updated one legacy auth test to reflect Task 4 removal of anonymous legacy business endpoints (`GET /api/agents` now 404).
- 2026-06-26 spec review follow-up:
  - RED: added assertions that denied/success audit events persist `request_id`, and that cross-workspace run/human-task/feedback-candidate queries return 404.
  - GREEN: `AuditService.record()` now persists `X-Request-ID` / `X-Request-Id`; workspace-sensitive helper queries in `human_tasks.py` and `execution.py` now constrain by `workspace_id` at query time.
  - Verification:
    - `apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_workspace_access_api.py -q` -> 12 passed
    - `apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q` -> 104 passed
    - `apps/api/.venv/Scripts/python.exe -m compileall -q apps/api/app apps/api/tests` -> passed
    - `git diff --check` -> passed
- 2026-06-26 code quality follow-up:
  - RED: added tests for non-member existing-workspace 404 with denied audit, strong validation for review decision payloads, success audit for approve/reject review decisions, and GET `/reviewers` read-without-write behavior.
  - GREEN: workspace context now audits denied access before returning 404 for existing same-org non-member workspaces; review decisions use typed `approve`/`reject` validation and write success audits; reviewer/group directory initialization moved out of GET handlers into app initialization.
  - Verification:
    - `apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_workspace_access_api.py apps/api/tests/test_execution_api.py -q` -> 21 passed
    - `apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q` -> 108 passed
    - `apps/api/.venv/Scripts/python.exe -m compileall -q apps/api/app apps/api/tests` -> passed
    - `git diff --check` -> passed
- Spec review re-check: passed.
- Code quality re-check: passed. Remaining note: existing same-organization non-member Workspace access returns `404`
  while writing `workspace.access_denied`; this is intentional to preserve the PRD's cross-Workspace probing behavior
  while still retaining denied audit evidence.

- 2026-06-26 Task 5 frontend authentication and workspace routing:
  - RED: after adding focused tests, ran `npm test -- --run src/auth src/pages/Login.test.tsx src/App.test.tsx src/api/http.test.ts`.
    The suite failed for the expected missing-feature reasons: `src/auth/AuthProvider.tsx` and `src/pages/Login.tsx`
    did not exist, `apiFetch` was missing, and `/w/:workspaceSlug/...` routes were not registered.
  - GREEN: implemented `apiFetch` with same-origin credentials, CSRF header propagation and one-shot
    `auth-session-expired`; added auth/workspace API clients, `AuthProvider`, protected workspace routes,
    login and invitation activation pages, workspace-aware layout/navigation, and explicit `workspaceId`
    signatures across frontend API modules and pages.
  - Verification:
    - `npm test -- --run src/auth src/pages/Login.test.tsx src/components/Layout.test.tsx src/App.test.tsx src/api/http.test.ts src/api/auth.test.ts src/api/workspaces.test.ts` -> 14 passed
    - `npm test -- --run` -> 41 passed
    - `npm run lint` -> passed with existing non-blocking Fast Refresh warnings on auth context files
    - `npm run build` -> passed
    - `git diff --check` -> passed; only LF/CRLF conversion warnings were emitted by Git

- 2026-06-26 Task 5 spec review frontend fix:
  - RED: tightened `src/api/http.test.ts` with explicit non-dispatch checks for `/api/auth/session` and
    `/api/invitations/token`, then ran `npm test -- --run src/api/http.test.ts src/auth src/pages/Login.test.tsx src/App.test.tsx`.
    The suite failed because 401 responses from both public endpoints still emitted `auth-session-expired`.
  - GREEN: narrowed `apiFetch` session-expiry dispatch to 401 responses under `/api/workspaces/` only.
  - Verification:
    - `npm test -- --run src/api/http.test.ts src/auth src/pages/Login.test.tsx src/App.test.tsx` -> 10 passed
    - `npm test -- --run` -> 43 passed
    - `npm run lint` -> passed with the existing non-blocking Fast Refresh warnings on auth context files
    - `npm run build` -> passed
    - `git diff --check` -> passed; only LF/CRLF conversion warnings were emitted by Git
