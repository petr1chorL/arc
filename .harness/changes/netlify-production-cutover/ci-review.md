# Workflow CI 修复独立审查

日期：2026-09-06。审查者：native_composition（未参与该修复实现）。
范围：`Workflows.tsx`、`Workflows.test.tsx`、`workflow-governance.spec.ts` 相对 HEAD 的改动，
对照 `ci-fix.md`、已确认请求生命周期设计/计划及项目规则。只新增本报告，未改实现。

## 结论

严重问题：0。可以进入主线程的精确 SHA 提交与云端 CI 验证。
这一结论仅认可已复现失效 effect 请求放大的最小修复及测试断言修正，不能代替新的云端 CI 成功。

## Spec 轴：因果与边界

- `Workflows.tsx:923` 在 `getRubrics`/`listModelProviders` 的 Promise.all 返回后、`listRubricVersions` 的每条请求前检查 isActive。
  原实现只在全部版本请求结束后检查失效，确实无法阻止已清理 effect 继续发出版本请求。
  cleanup 将闭包 isActive 设为 false；新的 effect 使用独立闭包，旧 effect 退出不影响当前目录加载。
- 相邻 Agent 目录已有同位置 active guard，改动沿用已有生命周期设计，没有增加新缓存或改变版本选择。
- 新测试延迟真实组件调用的量规目录 fetch，在 cleanup 后释放响应，并断言没有任何量规版本子请求；
  不是 mock 掉待验证的 effect。修复报告记录旧实现 RED；本独立审查重新执行该测试，1 passed、55 skipped、1.05s。
- `ci-fix.md` 的 429 复现和完整九项浏览器通过属于实现方本轮回执，本审查未重新跑完整浏览器，未将其冒充独立重放。
  源码证明该补丁减少无效请求；是否足以消除对应云端失败，仍由下一次精确 SHA 的云端 CI 确认。

## Standards 轴：不掩盖错误与不放宽契约

- 生产代码仅加一条生命周期 guard；未改请求预算、客户端 IP、重试、鉴权、CSRF、Origin 或错误状态处理。
- E2E 版本查询现在先断言 HTTP 200，再执行原数组/不可变快照断言。429/错误 JSON 会更早显式失败，
  没有通过默认空数组、宽松断言、异常吞掉或重试掩盖失败。
- 请求监视仍拒绝全部非测试 origin 请求。对于同源请求，只有 `/api/` 业务路径检查执行片段，
  修正原 `/src/api/notifications.ts` 静态模块误判，保留 runs/test-runs/human-tasks/notifications 的片段边界。
- 对修改后的原样判定式做八个独立样例核查：静态 notifications.ts、运行提交、Agent 测试运行、人工决策、
  通知派发、带查询参数 runs、版本查询和外域请求，全部符合预期。
- `scripts/reference-assets-e2e-server.mjs` 本次内容 diff 为空，未看到提高测试限额或改变测试 IP 的旁路。

## 对抗式剩余边界

无新增阻断项。仍有已明确记录的非本切片边界：首次目录请求未取消，活跃 effect 的逐量规版本查询仍是 N+1；
大目录或更高请求频率依然可能达到 120/min。当前设计和回执没有宣称这些问题已全部解决。
新的云端 CI 若再次出现 429，应根据请求证据继续诊断，不能根据本报告直接跳过发布门禁。

审查采用 expert-reviewer-front 的 Spec/Standards 两轴核查内容；本任务由主线程分派为独立复核，
没有额外占用并行名额或把自己实现的 native composition 算作独立审查。Vue 专属模板检查不适用于本 React 项目。
