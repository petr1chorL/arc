# V0.13H 验收说明：Worker CLI 启动入口

> 日期：2026-06-27

## 本版完成内容

V0.13H 把 V0.13G 的 worker 类推进到可启动的命令入口。

- `apps/api/pyproject.toml` 新增 `arc-one-worker = app.worker:main` console script。
- `python -m app.worker` 支持命令行启动。
- 支持 `--worker-id`、`--poll-interval`、`--database-url`。
- 支持 `--once` 只处理一次队列任务。
- 支持 `--until-idle` 处理到队列空闲后退出。
- README 本地运行说明新增 worker 终端和一次性验收命令。

## 没有完成的内容

- Docker Compose worker 服务。
- Windows 服务、systemd 或进程守护。
- worker 健康检查接口。
- worker 指标面板。

## 自动化验收

### Focused 验证

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_execution_worker.py -q
```

实际结果：

- 2 项通过。
- 覆盖 worker 类处理队列任务，以及 factory 从 database_url 构造 worker。

### CLI 验证

```powershell
cd apps/api
.\.venv\Scripts\python.exe -m app.worker --help
```

实际结果：

- 命令行帮助可正常输出。
- 可见 `--database-url`、`--worker-id`、`--poll-interval`、`--once`、`--until-idle` 参数。

### 全量回归

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q
npm test -- --run
npm run lint
npm run build
git diff --check
```

实际结果：

- 后端测试全量通过。
- 后端 181 项测试通过。
- 前端 27 个测试文件、101 项测试通过。
- `npm run lint` 通过。
- `npm run build` 通过。
- `git diff --check` 仅输出 Windows 换行提示，没有 whitespace error。

已知提示：

- 后端测试仍有既有 `StarletteDeprecationWarning`。
- 前端测试仍有既有 `--localstorage-file` Node warning。
- Vite build 仍有既有 chunk size warning。
