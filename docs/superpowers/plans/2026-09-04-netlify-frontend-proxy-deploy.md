# Netlify 前端代理部署实施计划

1. 建立部署策略回归测试
   - 验证：缺少 `netlify.toml` 时测试失败。
2. 添加最小 Netlify 配置
   - 验证：构建目录、API rewrite 顺序和 SPA fallback 测试通过。
3. 运行本地质量门禁
   - 验证：相关测试、lint、build 与 deployment check 通过。
4. 创建独立 Netlify 项目并发布 preview
   - 验证：首页、深链和 `/api/health` 可访问。
5. 发布 production deploy
   - 验证：生产 URL、精确 deploy 信息与线上冒烟通过。
6. 完成对抗式收口
   - 验证：明确 Netlify 仅托管前端，后端仍由 Zeabur 提供。
