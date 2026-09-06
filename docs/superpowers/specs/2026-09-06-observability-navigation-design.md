# 观测页运行选择：单一 URL 状态源

状态：主线程依据持续修复与迁移验收授权确认；不涉及生产数据/配置变更。

## 第一性原理

用户选中的运行、地址栏链接和加载的详情必须指向同一个运行。当前 selectedRunId state 与
requestedRunId URL 互相写入，导航异步提交时两个来源争夺同一个事实，形成无界循环。
已由独立诊断以延后首次默认导航、再选择新运行、释放旧导航的顺序稳定复现21次回写护栏失败。
这解释了一个真实可达振荡路径；不据此推断所有历史测试卡死都来自同一原因。

## 方案与兼容

1. 选中值由 URL 的有效可见 runId 决定；没有有效 runId 时，从当前过滤结果中派生默认风险运行/首项。
2. 保留无效/缺失 URL 的默认规范化。已有有效 runId 不被上一帧本地 state 反向覆盖。
3. 点击只写 URL，不同时更新镜像 state。导航 pending 时显示已提交 URL 的选择，不伪造另一个来源。
4. 旧运行详情请求在选择变化/Workspace变化/卸载后不得写回；使用 effect 生命周期守卫，不新增自动重试。
5. 筛选、nodeRunId 清除、浏览器 URL 导航及现有详情入口保持；不改后端、租约算法或业务运行状态。

## 验收与对抗审查

正式导航测试使用真实组件和 MemoryRouter，仅控制 useSearchParams setter 的提交顺序；
首次默认导航与用户新选择交错后必须有限导航、最终URL/选中一致。20次护栏是失败捕捉，不是产品截断策略。
补晚到详情响应不能覆盖新选择的回归。跑观测页、相关第三分片、lint/build及本地运行浏览器观测链。
不会通过增加内存、改pool、删用例或放宽超时把卡死伪装成通过。

## 最小实施计划

- `src/test/fixtures/observability.ts`：机械抽取已有测试字面量，替代诊断中的源码动态执行。
- `src/pages/Observability.navigation.test.tsx`：将明确RED转成永久导航竞争及详情迟到响应回归。
- `src/pages/Observability.test.tsx`：保留旧用例，改为共享fixture导入。
- `src/pages/Observability.tsx`：去掉选中 state 双向effect；派生选择、隔离详情请求生命周期。
- `.harness/changes/netlify-production-cutover/` 与项目状态：记录确定RED/GREEN与独立复审，不覆盖生产阻断。
