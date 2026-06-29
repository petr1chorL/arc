# V0.30J 验收记录：Notification Dispatch Details

更新时间：2026-06-29

## 第一性原理

发送器汇总只能回答“本次处理了多少、成功多少、失败多少”，不能回答排障时最关键的问题：哪一条通知失败、在哪个渠道失败、失败码和错误文本是什么。因此本版本的最小目标是把最近一次 dispatch API 已经返回的 item 事实展示出来，不新增新的执行能力。

## 对抗式审查

- 不把“本次明细”误命名为“历史”，避免用户误以为它是持久化发送记录。
- 不隐藏失败项的 `errorCode` 和 `error`。
- 不发明 API 没有返回的字段。
- 不新增单条重试、自动重试、批量发送、真实外部渠道或后端查询接口。
- 不把本次 dispatch 响应缓存成长期审计记录。

## 已实现

- 通知运维页触发发送器成功后，结果区展示“本次明细”。
- 每条明细展示 id、eventKey、status、channel、errorCode、providerMessageId 和 error。
- 失败项有视觉强调，并保留稳定失败码与错误文本。
- 当 dispatch 返回 `items: []` 时，展示“本次没有返回明细”。

## 非目标

- 不新增发送历史持久化。
- 不新增单条通知详情页。
- 不新增单条重新入队入口。
- 不新增后端接口、数据库字段或真实外部发送渠道。

## TDD 证据

- RED：`npm run test -- src/pages/Notifications.test.tsx --run` 曾失败，原因是页面尚未渲染“本次明细”和空明细状态。
- GREEN：实现后同一命令通过，`1 passed / 7 tests passed`。

## 最终验证

- `npm run test -- src/api/notifications.test.ts src/pages/Notifications.test.tsx src/components/Layout.test.tsx --run`：通过，`3 passed / 17 tests passed`。
- `npm run lint`：通过。
- `npm run build`：通过；保留既有 Vite chunk size warning。
- `git diff --check`：通过；仅有 Windows 换行提示。
- `Invoke-WebRequest -Uri http://127.0.0.1:4173/w/ai-capability-center/notifications -UseBasicParsing`：返回 200。
