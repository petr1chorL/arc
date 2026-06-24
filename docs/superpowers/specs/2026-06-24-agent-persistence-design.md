# Agent 创建与持久化设计

## 目标

交付 ARC.ONE 第一条真实纵向闭环：用户在 Agent 页面填写最小字段创建 Agent，前端通过类型化 HTTP API 保存，刷新页面或重启 API 后仍能重新加载该 Agent。

## 范围

本次只实现 Agent 的创建与列表读取，不实现编辑、删除、版本发布、工具绑定、模型调用和权限体系。现有其他页面继续使用 Mock 数据。

## 用户路径

1. 用户进入 Agent 页面。
2. 点击“新建 Agent”，填写名称、职责、负责人和模型。
3. 空字段在表单内显示字段级错误，不发送请求。
4. 提交成功后关闭弹窗，新 Agent 出现在列表顶部。
5. 刷新页面后，前端重新请求 API，Agent 仍然存在。
6. API 重启后，数据库文件中的 Agent 仍然存在。

## 架构

### 前端

- `src/api/agents.ts` 是 Agent 数据的唯一传输边界。
- `src/pages/Agents.tsx` 不再直接导入 Agent Mock 数组。
- `src/components/AgentCreateDialog.tsx` 负责表单状态、字段校验和提交反馈。
- 前端通过 `VITE_API_BASE_URL` 配置 API 地址，默认使用 `/api`。
- Vite 开发服务器将 `/api` 代理到 `http://127.0.0.1:8000`。

### 后端

- 后端位于 `apps/api/`，采用 FastAPI、Pydantic 与 SQLAlchemy。
- `GET /api/agents` 返回按创建时间倒序排列的 Agent。
- `POST /api/agents` 校验并创建 Agent。
- Agent 使用 UUID 字符串作为稳定标识，并保存 UTC 创建、更新时间。
- 默认数据库为 `apps/api/data/arc_one.db`，便于本机直接验证。
- 通过 `DATABASE_URL` 可切换 PostgreSQL；`compose.yaml` 提供 PostgreSQL 开发服务定义。

### 数据契约

创建请求的必填字段：

- `name`：名称，1-80 字符。
- `role`：职责说明，1-240 字符。
- `owner`：负责人，1-80 字符。
- `model`：模型名称，1-80 字符。

响应补充：

- `id`
- `status`，初始为 `调试中`
- `version`，初始为 `v0.1.0`
- `passRate`，初始为 `0`
- `runs`，初始为 `0`
- `tools`，初始为空数组
- `createdAt`
- `updatedAt`

## 错误处理

- 前端空字段由表单即时拦截。
- API 对空白字符串和超长字段返回 `422`。
- 网络或服务错误在 Agent 页面显示可重试错误状态。
- 创建按钮提交期间禁用，避免重复创建。

## 测试策略

- 前端契约测试覆盖字段映射与 HTTP 错误。
- 组件测试覆盖空字段校验、提交成功和失败反馈。
- API 集成测试使用临时 SQLite 数据库，覆盖创建、读取和重建应用后数据仍存在。
- 浏览器测试覆盖创建 Agent、刷新页面和再次看到该 Agent。
- 最终执行前后端测试、`npm run lint` 和 `npm run build`。

## 已知约束

当前机器未安装 Docker，因此本次会验证 SQLite 持久化和 PostgreSQL 配置可装载，但不能在本机证明 Compose 中 PostgreSQL 容器已实际启动。该限制必须在完成说明中明确记录。
