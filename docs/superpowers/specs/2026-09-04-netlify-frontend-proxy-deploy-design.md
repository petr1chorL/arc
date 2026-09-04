# Netlify 前端代理部署设计

## 背景

ARC.ONE 当前生产形态是 React/Vite 前端、FastAPI、异步 Worker 与 PostgreSQL 组成的单服务 Zeabur 部署。Netlify 可以直接发布 Vite 静态产物，但不能在不改造架构的前提下承载现有常驻 FastAPI 与 Worker。

## 第一性原理核查

- 底层目标：提供一个可访问、可深链、能继续调用真实业务 API 的 Netlify 入口。
- 必要对象：Vite `dist`、React Router 回退规则、同源 `/api` 代理、现有已验证的 Zeabur 后端。
- 必要约束：不复制数据库、不迁移 Worker、不暴露密钥、不把静态站误报为完整后端迁移。
- 当前切片优先：复用现有后端并只迁移前端托管，能够以最小改动形成真实可用闭环。

## 方案

新增根目录 `netlify.toml`：

1. 使用 `npm run build` 生成 `dist`。
2. 优先将 `/api/*` 以 Netlify rewrite 代理到现有 Zeabur 同路径 API。
3. 再将其他路径 rewrite 到 `/index.html`，支持 React Router 深链。
4. 先发布 deploy preview 并验证，再发布 production deploy。

不安装 `@netlify/vite-plugin`，因为当前没有使用 Netlify Functions、Blobs、DB 或其他需要本地运行时集成的能力。

## 对抗式审查

- 错误完成感：本次是 Netlify 前端入口，不是 FastAPI、Worker 或 PostgreSQL 迁移。
- 权限与会话：浏览器仍通过 Netlify 同源 `/api` 访问，避免在客户端暴露跨域后端地址；登录与 CSRF 仍由现有后端执行。
- 路由风险：API 规则必须位于 SPA catch-all 之前，否则 API 会误返回 `index.html`。
- 可用性风险：Netlify 入口依赖 Zeabur 后端；后端不可用时 Netlify 页面仍可加载，但业务请求会失败。
- 安全风险：配置只包含公开生产 URL，不读取、复制或提交任何 Token、数据库连接或模型凭证。

## 验收

- 配置策略测试先红后绿。
- lint、build 与相关测试通过。
- Netlify preview 可加载，深链返回 SPA，`/api/health` 返回后端健康响应。
- production deploy 成功并完成相同验证。
