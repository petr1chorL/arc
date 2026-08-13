# CI Vitest Worker 隔离设计

## 背景

PR #35 的 GitHub Actions 在单 worker 顺序执行前端测试时，于约 36 分钟后触发 JavaScript heap OOM。失败进程接近 4 GB 堆上限；46 个测试文件中已有 45 个完成，唯一未完成的是 `src/pages/Observability.test.tsx`。

## 诊断证据

- `src/pages/Observability.test.tsx` 单独执行时，12 项测试在约 4 秒内通过。
- CI 失败前出现的三个页面测试组合在本地约 31 秒内通过。
- 同一套 46 个文件按 8 个独立 Vitest 进程顺序分片时，285 项测试全部通过；最慢分片约 33 秒。
- 因此没有证据支持修改产品代码或 Observability 断言。现有证据更符合 Linux/Node 24 下长生命周期 worker 的非确定性堆膨胀。

## 第一性原理核查

- 底层目标：让每次 CI 都能在有限内存中完成同一套前端测试，而不是放宽测试或提高堆上限掩盖增长。
- 必要对象：测试文件集合、稳定分片规则、独立 Vitest 进程和失败即终止的 CI step。
- 必要约束：所有测试只执行一次；任一分片失败则任务失败；保持单 worker，避免并行峰值内存；不修改产品行为。
- 当前切片优先：进程边界能确定释放堆，改动小于重写页面测试，也比提高 `max-old-space-size` 更直接控制风险。

## 方案

在现有 `Run frontend tests` step 内顺序运行 8 个 Vitest shard。每个循环调用都是新的 Node/Vitest 进程，退出后由操作系统回收堆；仍保留 `maxWorkers=1` 与 `no-file-parallelism`，避免单分片内部产生高峰并发。

新增 CI 策略测试，约束工作流必须保留 8 分片和独立进程调用。Vitest 的稳定哈希分片保证全部测试文件被恰好分配到一个分片。

## 未采用方案

- 提高 Node heap：只延迟 OOM，无法证明内存增长受控。
- 删除或弱化 Observability 测试：单文件已稳定通过，没有产品测试缺陷证据。
- GitHub Actions matrix：可缩短时间，但会并发占用更多 runner，超出本次最小修复范围。
- 仅拆成两个分片：本地首个二分片曾长时间无输出，8 分片有完整通过证据，边界更清晰。

## 对抗式审查

- 错误完成感：本地通过不能替代 GitHub Actions 复跑；PR 仍需新的远端成功证据。
- 漏测风险：策略不使用手工文件清单，避免新增文件未进入 CI；完整本地结果必须仍为 46 个文件、285 项测试。
- 资源风险：顺序分片降低峰值内存，但增加 8 次启动开销；本地总时长仍低于两分钟，代价可接受。
- 失败路径：GitHub Actions 的 bash step 默认失败即退出；任一 shard 非零退出码都会阻止后续门禁。
- 文档边界：该修复只提升 CI 测试进程隔离，不代表生产运行时或产品功能发生变化。

## 验收

- CI 策略回归测试通过。
- 8 个 shard 合计覆盖全部前端测试，全部通过。
- `npm run lint`、`npm run build`、部署配置检查和 diff 检查通过。
- PR #35 的 GitHub Actions 获得新的成功结果。
