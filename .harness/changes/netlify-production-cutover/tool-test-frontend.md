# Tool 测试 202 前端切片

日期：2026-09-06。状态：local-pass，待整合浏览器与独立审查。依据已确认 HTTP Tool Operation 设计、计划及 07e。

## 实现前设计与计划

最小用户价值是区分受理和执行完成，并能刷新恢复查询，不新增原始内容可见性或实际 MCP 能力。

1. `src/api/assetLibrary.ts` 及测试：复用 Operation response/headers，保留旧同步 Invocation，原生 202 不伪装完成；添加可选显式幂等键，调用方重试同请求可复用。
2. `src/types.ts`：Invocation 仅追加可选 operationId，不收紧旧同步历史状态字符串导致契约破坏。
3. `src/api/migrationCapabilities.ts` 及独立测试：新增 Tool 测试能力，runtime 可用、前序资产迁移仍禁用；Provider 能力不变。
4. `src/pages/AssetLibrary.tsx` 及测试：Workspace keyed 内部页面与 effect 生命周期边界；202 只显示已受理、追踪 ID/刷新历史；原生历史正文继续隐藏。
5. `src/components/OperationCenter.tsx` / `OperationProgress.tsx` 及测试：Tool cancel/requeue 要求 agent.write，核对要求该能力与 workspace.manage；复用已有 sessionStorage ID 恢复。
6. 聚焦 RED→GREEN、相关组件/API测试、lint/build；浏览器由主线程整合受控本地 HTTP Tool fixture 后验收，不调用真实目标。

## 对抗式边界

202 不是 Invocation 成功；Operator 的 run.execute 不可变相执行 builder 才能创建的 Tool 操作；
未知结果不自动重发；Workspace 切换和卸载后的请求不写新页面；只追踪同 Workspace 自建查询 URL，
不能跟随返回的任意 statusUrl。原生历史及 Tool Operation 不显示输入、输出或任意 result 正文。

## 验证

- API RED：原测试 POST 没有 Idempotency-Key、不广播受理事件；改用已有 Operation headers/response 后通过。
  legacy HTTP 201 继续返回原 Invocation；显式相同第四参数幂等键可在人工重试时复用，无自动重放逻辑。
- 能力 RED：不存在独立 Tool 测试能力；新增后 runtime 开放、所有前序迁移模式仍禁用，Provider 使用的原资产能力不变。
- 权限 RED：operator 能看到 Tool 取消按钮，agent.write-only 能力不能看到重排；新增 kind-aware 判断后通过。
- 页面 RED：runtime Tool 按钮仍禁用；打开获批范围后，202 只提示“测试已受理，尚未完成；请查看异步任务进度。”，
  记录操作 ID 和本 Workspace 查询链接，重用 OperationCenter 的 sessionStorage ID 恢复机制。
- Race RED：切换 OperationProgress 的 Workspace/Operation 后，旧取消响应覆盖新面板；新增 keyed 内部面板后忽略旧响应。
- 读取失败 RED：受理成功后的历史刷新错误掩盖受理提示；将历史读错误与提交状态分离，提供“重试调用记录”，测试确认仍仅一次 POST。
- `node node_modules/vitest/vitest.mjs run src/pages/AssetLibrary.test.tsx src/api/assetLibrary.test.ts src/components/OperationProgress.test.tsx src/components/OperationCenter.test.tsx src/api/migrationCapabilities.test.ts`：
  5 files / 31 tests passed，4.17s。
- `npm run lint`：通过，0 warning；`npm run build`：通过（292 modules，既有 >500kB bundle 提示）。
- `git diff --check`：通过，Windows CRLF 提示仅换行规范化提醒。

## 对抗式检查与本地边界

- 202 不进入 testResults（旧完成 DTO）；后续持久状态事件更新“工具测试：失败/已完成/结果待核对”，没有本地虚构结果。
- 原生历史输入/输出/历史 assetName 不显示；Tool Operation 的任意 result 不直接 JSON 展示。只依赖后端固定安全诊断。
- Invocation 新增可选 operationId，不改变旧状态 string 或同步 DTO；历史链接由当前 workspacePath 构造，不访问外部 statusUrl。
- runtime 测试要求 agent.write，disabled 资产不能提交；前端不新增真实 MCP 接入，并明确“仅记录未配置失败”。
- OperationCenter 使用当前角色导出 agent.write；Tool cancel/requeue 根据该能力，reconcile 还需 workspace.manage。
  后端权限是最终边界，本切片不声称 UI 按钮即完整授权。
- Workspace key 重建 AssetLibrary 内部状态；初始目录失效检查、调用记录查询序号、Tool 响应存活检查避免旧空间请求污染当前页面。
- 刷新恢复及 operator→builder 权限更新由组件测试验证；真实浏览器验收夹具和后端由主线程/另一 Agent 整合，尚不能由本回执替代。
- 未修改 Netlify 后端、scripts、Vite、CI、公开 Function、真实环境或凭证，未提交代码。
