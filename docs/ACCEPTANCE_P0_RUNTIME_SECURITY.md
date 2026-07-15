# P0 运行时安全收口验收记录

> 历史验收记录：本文第 3 项所述 Python Package 元数据登记/UI 已于 2026-07-15 被远程
> Agent API 切片取代；当前行为与新证据见 `docs/ACCEPTANCE_REMOTE_AGENT_API.md`。

日期：2026-07-10

## 验收范围

1. 模型资产不再接受内联 Key；模型出口仅允许 HTTPS + `MODEL_ALLOWED_HOSTS`。
2. 历史非法 Provider/AgentVersion Secret Ref 在启动时幂等清理。
3. Python Package 仅登记元数据，不在 API 进程内导入或执行。
4. Workflow 校验和 Runtime 阻断跨 Workspace AgentVersion/WorkflowVersion 引用。
5. 前端明确呈现上述边界，部署入口暴露对应配置。

## RED 证据

- 模型网关与 Provider API：5 条测试失败，证明当前代码仍接受内联值、允许未批准/HTTP Host，并会让绑定 Provider 回退全局 Key。
- 历史清理：测试收集失败，证明清理函数尚不存在。
- Package Runtime：测试得到 `已完成` 而非 `失败`，并执行了临时模块导入副作用。
- Workspace：校验返回 `valid=true`，执行服务没有抛错且调用了 FakeGateway。
- 前端：2 个模型资产测试和 1 个 Package Agent 测试失败，证明安全文案、拦截和禁用状态尚不存在。
- 部署：验证器发现 `.env.example`、Render 和部署值模板缺少 `MODEL_ALLOWED_HOSTS`。

## GREEN 与回归证据

| 检查 | 结果 |
|---|---|
| 模型网关 + Provider API 聚焦测试 | 14 项通过 |
| 历史清理聚焦测试 | 2 项通过 |
| Agent Runtime 聚焦测试 | 4 项通过 |
| 跨 Workspace 聚焦测试 | 2 项通过 |
| Agent + Execution API 回归 | 51 项通过 |
| 完整后端 `pytest apps/api/tests -q` | 305 项通过，323.6 秒 |
| 完整前端 `npm test -- --run` | 42 个文件、238 项通过 |
| `npm run lint` | 通过 |
| `npm run build` | 通过；保留已有大包警告 |
| `node scripts/verify-deployment.mjs` | 通过 |
| 静态危险路径扫描 | 零命中 |

完整后端只报告 Starlette TestClient 对未来 `httpx2` 的弃用警告；前端测试只报告
`--localstorage-file` 测试环境警告，均不影响本次验收结论。

## 浏览器证据

浏览器使用 `127.0.0.1:54173`、一次性 SQLite 和一次性管理员完成，不读取或修改真实
业务库：

- 模型资产页展示 `Secret Ref（环境变量名）`，占位符为 `DEEPSEEK_API_KEY`。
- 输入 `inline-secret-value` 后页面显示固定错误，资产列表仍为 0，未创建记录。
- Package Agent 详情显示“Python Package 当前仅登记元数据，尚未接入隔离执行器”。
- 当前发布版本的“运行 Agent”按钮为 disabled，并显示不可运行原因。
- 页面控制台错误为 0，首屏截图未发现文本重叠。

## 第一性原理复核

- 原始模型凭证只能来自服务端配置，不再存在浏览器到数据库的原始 Key 通道。
- 凭证只有在最终出口 Host 通过校验后才会解析并使用。
- 未隔离的代码没有执行路径；保存元数据不再制造“已接入 Runtime”的完成感。
- Workspace 既在发布前校验，也在执行时重新确认，不依赖单层权限入口。

## 对抗式复核

- 非法 Secret Ref 的 API 错误响应不回显提交值；清理过程不记录原值。
- 绑定 Provider 缺少引用时 fail closed，不回退全局 Key。
- Package Manifest 即使包含本地 `packageSource` 和有效 `entrypoint` 也不会被导入。
- 历史恶意工作流快照即使绕过发布校验，也会在 ExecutionService 被 Workspace 条件阻断。
- `MODEL_ALLOWED_HOSTS` 使用精确 Host，不接受后缀匹配；HTTP、URL 用户信息、query 和 fragment 均被拒绝。

## 明确未实现

- 尚未接入 Vault/Secret Manager 管理 API；第一阶段只支持后端环境变量名引用。
- 尚未实现 Python Package 的容器/独立 Worker、签名验证、Hash 校验和资源配额。
- 尚未实现 DNS 解析后的私网地址阻断；当前边界是运维显式精确 Host 白名单。
- 不提供跨 Workspace 资产共享或授权。

此前曾在界面或聊天中暴露过的真实模型 Key 仍应在模型服务控制台轮换；代码清理不能
撤销已经泄露的凭证。
