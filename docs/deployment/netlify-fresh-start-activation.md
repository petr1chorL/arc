# Netlify全新启用操作说明

状态：候选代码实施中；不是已完成生产验收。管理员邮箱已由用户确认，密码要求稍后安全设置。
不迁历史数据、不复制旧凭证、不清空目标库，不为旧数据导出升级Zeabur。

## 两阶段启用

1. 候选阶段：只注册 `/native-api/*`，原 `/api/*` 仍代理Zeabur。生产平台变量
   `ARC_NATIVE_MODE=disabled` 明确保持业务关闭；新标记表随前向迁移部署，不包含任何预置用户。
2. 用户准备凭证后，核对目标库/初始化门禁，通过精确CI和发布再启用新平台。
   缺少初始化完成标记时，API、定时任务和已认证消费者都不得进入业务处理。
   后台Function的HTTP202不是业务成功；须读取持久Operation结果及Outbox证据。

## 用户在Netlify安全入口设置（不要贴聊天或提交仓库）

作用域应覆盖Functions，环境选Production；保存后需要新部署才能生效。

| 变量 | 值或要求 |
| --- | --- |
| ARC_INITIAL_ADMIN_EMAIL | 用户已确认的首位管理员邮箱 |
| ARC_INITIAL_ADMIN_PASSWORD | 由用户自行设置的新密码，12–1024字符且非全空白；按平台支持标记为Secret |
| ARC_QWEN_API_KEY | 对应百炼地域/Workspace的API Key；按平台支持标记为Secret |

不得创建VITE_前缀的密码/API Key变量，不复制生产密钥到本地.env或聊天中。
若平台不提供所需的安全存储/作用域能力，先报告实际限制，不关闭扫描、不购买套餐或改用明文前端配置。
初始化成功后可关闭ARC_FRESH_START并移除初始密码变量；程序不会因为变量变化重设已有管理员密码。

## 由执行者配置的非密钥项

- `ARC_NATIVE_MODE=runtime`：正式开启前保持disabled。
- `ARC_FRESH_START=enabled`：只在新目标准备好且初始密码已安全设置后开启。
- `ARC_NATIVE_RUNTIME_CONFIG`：显式绑定ARC Workspace、精确模型域名及Secret Ref；默认为空绑定，不能外呼。
- `VITE_ARC_ONE_MIGRATION_MODE=runtime`与`VITE_ARC_ONE_API_BASE_PATH=/native-api`：必须配对，供新前端验收。
  未配对或使用其他入口/外部主机时前端拒绝请求；默认旧构建仍使用/api。
- 完成新平台验收后，才移除旧/api代理并将/api路径注册给原生Function，重新发布与复验。

## Qwen 3.8 Flash

用户指定模型的官方ID为 `qwen3.8-flash`，不替换其他型号。
[官方模型说明](https://help.aliyun.com/en/model-studio/qwen3-8-flash)。

采用OpenAI兼容Chat Completions。优先使用百炼控制台给出的实际Workspace专属Base URL，
并把该URL的精确hostname加入ARC绑定；不能用API Key所属地域以外的地址。
北京旧地址 `https://dashscope.aliyuncs.com/compatible-mode/v1` 仍有效，但不据此假定用户就是北京地域。
[官方接口与地域地址](https://help.aliyun.com/en/model-studio/qwen-api-via-openai-chat-completions)。

商业模型支持同步非流式输出，默认思考会增加耗时；当前网关仍有60秒总时限，真实小样本调用前应确认配置与预算，
不因超时自动重放未知结果。[官方思考模式说明](https://help.aliyun.com/en/model-studio/deep-thinking)。

平台成本字段是美元。仅在确认实际美元单价后设置inputCostPerMillion/outputCostPerMillion；
不要直接把人民币单价填入美元字段，不把costConfigured=false的零值当作免费或准确账单。
本轮不调用真实模型、不假定API Key已配置。

## 验收与停用

- 新账号登录与密码修改、Workspace/角色/CSRF/跨空间拒绝。
- 新建Provider/Agent/版本/Workflow；真实运行由202到终态，刷新可恢复，错误有明确结果。
- 人工审核和恢复、评估、产出物/Trace、站内通知与定时派发；外部通知未配置则明确未验收。
- 记录精确提交、部署ID、定时/异步结果以及实际观察时段，不用健康200或合成测试代替真实业务。
- 用户确认新平台可用且无旧依赖后，核实ARC专属Zeabur服务再停用；不删除共享服务器或历史库。
- 停用后再验证Netlify；若失败则停止后续停用，保留新库写入并修复前进，不盲目回旧库。
