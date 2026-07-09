# V0.30F 验收记录：Notification Outbox Query

## 第一性原理

通知运维的底层目标是“找到需要处理的通知事实”。在做通知面板、告警规则或批量恢复之前，平台必须先能按 Workspace、状态、渠道和失败码取回有界通知记录。

## 对抗式审查

- 查询不能泄露其他 Workspace 的通知。
- 查询不能无界扫描，必须有 `limit` 上限。
- 不能只覆盖成功发送记录，失败和待发送记录才是运维重点。
- 不能为了第一版查询新增数据库字段或索引。
- 不能把查询 API 误写成告警系统或批量处理能力。

## 已实现

- 新增 `GET /api/workspaces/{workspace_id}/notifications/outbox`。
- 要求 `workspace.manage` 权限。
- 默认按 `created_at desc` 返回当前 Workspace 通知。
- 支持 `status` 筛选。
- 支持 `channel` 筛选，匹配 `payload.dispatch.channel`、顶层 `payload.channel` 和 `payload.channels`。
- 支持 `errorCode` 筛选，匹配 `payload.dispatch.errorCode` 或 `payload.dispatch.error_code`。
- 支持 `limit`，范围为 1 到 200。

## 本版本不包含

- 不新增前端页面。
- 不新增数据库字段或索引。
- 不实现分页游标。
- 不实现批量重新入队。
- 不实现告警发送。
- 不接入真实外部渠道。

## TDD 证据

RED：

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_notification_dispatcher_api.py -q
```

结果：失败，2 个新用例因查询路由不存在返回 404。

GREEN：

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_notification_dispatcher_api.py -q
```

结果：13 个测试通过；保留一个既有 Starlette `on_event` 弃用警告。

## 最终验证

```powershell
apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_notification_dispatcher_api.py apps/api/tests/test_notification_worker.py apps/api/tests/test_observability_api.py -q
```

结果：28 个测试通过；保留一个既有 Starlette `on_event` 弃用警告。

```powershell
npm run lint
```

结果：通过。

```powershell
npm run build
```

结果：通过；保留既有 Vite chunk-size warning。

```powershell
git diff --check
```

结果：通过；仅提示 Git 将在下次触碰部分文件时把 LF 替换为 CRLF。

## 验收结论

V0.30F 满足当前切片目标：Notification Outbox 已具备受 Workspace 隔离保护的运营查询 API，可按状态、渠道和失败码定位通知记录。
