# Netlify全新启用候选：整合验证回执

日期：2026-10-27。用户批准不迁历史数据、先完成代码，管理员密码稍后安全配置。
本回执只覆盖代码与候选发布准备，不是实际登录/真实模型/稳定观察/Zeabur停用的签收。

后续结果：功能提交dc17558的CI40446258789已全部成功，包含6项真实PG用例及浏览器套件。
Netlify同提交部署6ae01f2ac5842949d31e8178失败，用户诊断截图指出GitHub CI查询HTTP403；
不是功能CI未通过。发布查询的认证可选支持/有界恢复修复见ci-query-verify.md；用户选择不创建Token。
下方PG待验为提交前记录，不覆盖此已核实CI结果；新脚本的CI/发布仍需独立核验。

## 已完成的云端基线恢复

- 完全访问环境下，现有官方CLI能读取站点/部署；不再把此前短暂代理恢复称为持久修复。
- 远端codex/harness-governance为f310ecb，其精确CI34027931758成功。
- 官方 `deploy --trigger` 触发Git构建，不上传工作区、用户研究文件或本地配置。
- 部署6ae014a99f4eb50963428486成功发布f310ecb，published_at=2026-10-27T03:05:40.281Z。
- 官方database status确认8条结构迁移已应用，新的native-bootstrap-state仅在本地待后续发布。
- 已显式设置production的ARC_NATIVE_MODE=disabled；需新部署生效，没有配置初始密码或模型Key。
- 当前/api代理Zeabur未删除；未付款、未迁历史、未关闭旧服务。

## 本次实现

- 原生API过渡入口仅/native-api/*；模式严格runtime才开启。前端同源候选入口必须与runtime模式配对。
- 初始化仅取服务端配置；单例标记、事务与表锁保护空目标，身份/成员/审计/标记原子保存，完成后不读取初始密码或重置账号。
- 非空目标拒绝，不清库、不授予额外专家资格；错误包含连接、回滚、release均固定化。
- 发现并补齐P1：mode开启但无初始化标记时，API/tick以及认证后consumer均不进入旧身份/旧队列业务。
  API/tick固定503，consumer按SDK失败/重试处理；平台202/ack从来不表示业务完成。
- AWL只携带Operation ID，SDK认证先于DB/发送器访问；每分钟tick有界派发，不同步执行模型。
- 原生健康接口真实SELECT1，且先经过初始化门禁；数据库失败固定503，不回显原始错误。
- 关闭模式无业务DB/配置/Secret读取；SDK冷模块读取NODE_ENV是明确允许的非敏感元数据。
- schedule/event已注册，mode关闭不等于完全无平台唤醒或零额度消耗；不是先前的“无schedule/event硬休眠”。

## 新验证

- 初始化、连接/release脱敏、缺初始化标记、候选路由、原生健康、前端路径/错误配置均有明确RED→GREEN。
- 主线程完整前端8分片一次连续通过：71文件701项。
- 新增关闭/初始化/平台纯测试18项通过；既有native-deployment/config回归12项通过。
- lint、前端与Netlify类型检查、build、deploy:check、diffcheck通过；保留已有bundle体积提示。
- Node测试运行器边界曾明确失败，新native-platform-host排除于Vitest且加入原生CI入口后通过。
- Spec/Standards独立审查与增量复审0剩余严重项；审查报告分别保存，不混同执行证据。
- **6项真实PG用例尚待CI**：5项初始化/事务/并发/登录和1项平台组合；本地连接失败不是通过。
- 本机Docker启动因Secrets Engine engine.sock错误崩溃；未重置Docker、删除socket、容器或用户数据。
  已停止本轮自建的两个挂起只读Docker CLI及其专属shell；未终止Docker后端或其他项目进程。
- 使用现有GitHub CI临时PostgreSQL、24程序验证入口及两套浏览器套件补充真实证据；精确结果必须另查。

## 人工配置与关闭前置

用户模型选择为官方ID qwen3.8-flash。尚未取得其实际地域/Base URL与Key、初始密码，未做真实调用。
操作顺序和安全变量见docs/deployment/netlify-fresh-start-activation.md。
后续验收包含真实用户登录、资产/版本、持久运行、人审恢复、评估/产出物/Trace、调度与实际观察。
未完成这些步骤不关闭Zeabur，也不把本候选或既有合成测试报告成全新启用完成。
