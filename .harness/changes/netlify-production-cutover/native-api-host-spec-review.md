# 内部 API 宿主接线 Spec 轴独立审查

2026-09-06。依据 native-api-host.md 的设计与AC；审查 api-host/router/deployment、新native-api-host测试，
并追踪 reference-assets 与 runtime-closure 两个真实 backend 的选项消费。
本报告只做Spec轴，另一位审查者独立负责Standards；未修改实现或停止容器。

## 结论

限定内部宿主接线的业务AC满足，未发现实现阻断问题。测试注册整合项也已刷新复核关闭；
本结论不放行公开宿主、AWL、调度、真实Secret/生产模型、备份或切流。

## 验收逐项核对

- **关闭零读取**：api-host构造只封装延迟函数；deployment门禁在loadBackendOptions与loadPool之前。
  新测试用config/pool/Secret/fetch getter抛错验证关闭时均未读取，响应404/no-store。
- **配置先于数据库**：deployment先await loadBackendOptions；内部factory在其中校验运行配置后才交给loadPool。
  非法配置统一503固定正文，未初始化pool或解析Secret；同一handler随后恢复配置可到达正常401鉴权边界，
  没有永久缓存首次失败。既有数据库初始化失败重试/脱敏测试仍通过。
- **真实Provider消费**：router将providerOptions传入createPostgresReferenceAssetsBackend；其dispatch先
  workspaceContext(write=true)完成Session/CSRF/Workspace，再checkProviderConfiguration的agent.write与
  scoped Provider读取，最后才调用secretPresence。新的配置存在性不是绕过业务权限的直接公开端口。
- **费用实际消费**：router将closureOptions传入createPostgresRuntimeClosureBackend，后者传给readClosure；
  cost-usage响应严格取options.costConfigured===true。真实PG查询证明省略false，双零及正值费率true，
  不再是无消费者的返回对象；该标志仍不代表生产账单已核定。
- **每请求IP**：HandlerOptions逐次传入，不缓存首请求IP。真实identity_rate_limits中同时出现两种可信
  宿主IP的digest bucket，伪造X-Forwarded-For对应bucket未出现。
- **兼容默认调用**：router第三参数和deployment的选项loader可省略，既有域选项仍使用缺配置默认值；
  原6项门禁/路由和5项运行配置回归全部通过。

## 独立新证据

使用主线程提供的loopback55433合成数据库，新随机schema由helper创建并finally清理；未操作容器生命周期。

| 程序 | 结果 |
|---|---|
| native-api-host.test.mjs | 3 passed，569.58ms |
| native-deployment.test.mjs | 6 passed，32.71ms |
| native-runtime-config.test.mjs | 5 passed，24.49ms |

真实PG测试包含实际合成登录、默认/零/正费率、401/CSRF403/viewer403零Secret解析、错Workspace绑定missing，
正确绑定ready且一次解析；只注入合成值，fetch如果被调用会失败，不访问模型/通知或平台。

## 测试注册整合（已关闭）

初次读取处于主线程补两处的中间状态；随后独立刷新确认vite精确排除与verify-runtime-local的
18程序数组均包含native-api-host.test.mjs。独立再次运行test-runner-boundary：1 passed，670ms。
该测试不会被jsdom误收集，也不会从独立CI验证清单遗漏；实际云端运行仍需最终提交SHA的结果。

## 明确保留范围

未新增公开Function、Netlify环境读取、context.ip获取、数据库生产连接、worker调用、AWL事件或定时入口。
未来公开宿主仍需独立验证平台可信元数据/配置来源；本内部factory不能替代这些生产证据。
