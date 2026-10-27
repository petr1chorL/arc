# CI查询403：修复回执

日期：2026-10-27。用户选择匿名查询，不创建Token。没有读取CLI凭证、环境变量存量Secret或创建真实访问密钥。

## 最终核验（覆盖下方待核验快照）

- 修复提交61ffa908b014e6f3d8278ba15f35bd15735baae8已推送，push CI40454469748全部成功，watch退出码0。
- Netlify production部署6ae033e45bbfd4aec8773139为ready且为项目current；commit_ref精确匹配61ffa90，
  published_at=2026-10-27T05:33:17.788Z，无error_message。
- 本次保持匿名且成功发布；不是已证明403永久消失，也不证明此前403一定是限流。
- 官方database status确认9条结构迁移已应用，pending/missingOnDisk/outOfOrder均为空；没有直接DDL/清库。
- 匿名GET：首页200/ARC.ONE标题；/native-api/health与/auth/session均JSON404“原生运行模式未启用”。
  新后端尚未启用、管理员未初始化，不能称业务验收通过。
- 旧/api/health与直连Zeabur/api/health当前都404 text/plain；本轮未停用或修改Zeabur，未确定旧端404原因。
- 仅文档回执后续同步不改变已验证运行代码；用户密码/Qwen Key、真实运行/人工验收和Zeabur停用仍待完成。
- 已通过官方CLI将用户确认的初始管理员邮箱写入Production变量；未配置密码/Key、未创建账号，
  此配置需后续部署生效。实际邮箱不写入本公开仓库记录。

## 已核实事实

- 功能代码dc175587a6ae7ec70888abac35434210400fc608的CI40446258789已全部成功（主线程gh只读核验）。
  原6项PG待验已由这次完整CI覆盖；不把Netlify发布失败写成应用测试失败。
- Netlify部署6ae01f2ac5842949d31e8178失败；用户提供诊断截图指出门禁脚本收到GitHub HTTP403。
  截图是平台生成的诊断而非完整响应头，不能断言已证明主/次级限流或Token权限错误。
- 代码确认原请求从不发送认证；仅在控制台添加GITHUB_TOKEN不会改变旧实现。
- 官方CLI读取部署日志曾返回404并发生本地UV断言；未用内部接口、读取Token或绕过门禁继续部署。

## 改动与新验证

- 可选构建Token参数、固定GitHub端点、不跟随重定向、合法正整数运行ID；不记录Token或响应正文。
- 两次共享HTTP额外重试预算；403/429按可信头识别与等待；长等待/未知重置/权限失败继续阻断。
- 网络与网关错误短退避，所有传输/JSON原始异常固定化；CI身份和成功条件保留。
- 主线程认证、限流、网络/脱敏、运行ID四组明确RED→GREEN。
- 最终门禁与部署契约共40项通过；lint、build（含Netlify类型）、deploy:check、diffcheck通过。
- 首次沙箱测试因临时文件rename EPERM未执行用例；经过正常受控权限申请后才取得真实RED/GREEN，没有改测试绕过失败。
- 两份独立Spec/Standards报告均0已证实严重项；各自验证范围见对应报告。
- 尚未验证新脚本的真实云端结果；匿名恢复能力不能保证避免未来限流。没有关闭Zeabur。
