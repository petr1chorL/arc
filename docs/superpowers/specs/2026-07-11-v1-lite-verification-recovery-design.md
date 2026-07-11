# V1.0 Lite 可重复验证恢复设计

## 决策

采用 Python 3.12 重建 `apps/api/.venv`，并用单一 Python 进程承接 Playwright API 服务。
E2E 入口生成唯一 SQLite URL、固定非生产测试管理员和开发安全配置；bootstrap 成功后
在同一进程启动 Uvicorn，避免 Playwright 退出后残留子进程。

## 方案比较

### 方案 A：修复当前仓库内 Python 3.12 + 单进程 E2E 入口（采用）

优点：与 CI Python 版本一致；Playwright 直接管理 Uvicorn 所在进程；可以显式隔离数据库
和测试账号。缺点：应用包中增加一个只用于本地 E2E 的入口模块。

### 方案 B：把仓库迁到纯 ASCII 路径

拒绝。Python 3.12 已证明当前路径可用，迁移仓库会破坏现有 worktree、文档和用户路径。

### 方案 C：Playwright 继续复用手工启动服务

拒绝。会污染默认数据库，也可能把已经运行的旧服务当成新验证证据。

## 数据与进程边界

```text
Playwright
-> Python 3.12 E2E server（唯一 SQLite + 测试管理员）
-> 同进程 Uvicorn :48100
-> Vite :48173
-> 浏览器登录
-> Workspace Agent / Workflow 路径
```

Playwright `globalSetup` 显式管理 Python/Uvicorn 与 Vite 两棵进程树，并在 teardown
逐一终止。测试进程注册不进入生产入口的 shutdown 路由，优雅停止 Uvicorn 并释放应用
与 bootstrap 两套数据库 engine；Node 再按本次 run ID 清理 SQLite、WAL 和 SHM 文件，
强制终止只作为启动失败兜底。任意 bootstrap、Uvicorn、Vite 或清理失败都必须让 E2E
失败。

## 安全边界

- 测试账号固定为非生产用途，不复用真实邮箱或密码。
- 数据库文件使用 `.scratch/e2e/` 下唯一名称。
- 不加载项目 `.env` 中的模型 Key；E2E 路径不发起模型调用。
- 不修改 Zeabur、默认 SQLite 或现存业务记录。

## 验证

1. E2E 环境生成函数单元测试先 RED 后 GREEN。
2. Playwright 旧配置失败作为集成 RED。
3. 完整后端、前端、lint、build、部署检查和 E2E 同轮执行。
