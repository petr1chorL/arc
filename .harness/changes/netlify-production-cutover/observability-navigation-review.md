# 观测页导航与详情修复：独立复审

日期：2026-09-06。审查者 `ci_workflow_fix`，负责确定性回归与本报告，未修改产品实现。
依据：`docs/superpowers/specs/2026-09-06-observability-navigation-design.md`、Issue 07f。

结论：本次有界产品修复无未关闭严重项；两条已证实缺陷均具备RED→GREEN，原12例无回归。

## 功能与边界

- `src/pages/Observability.tsx` 的选择从有效且可见的URL runId派生；无效/缺失时按风险首项、过滤首项回退。
  原默认URL规范化仍保留；不存在独立选中state再反向覆盖有效URL的第二来源。
- 风险卡片和最近运行点击仅通过既有writeSearchParams写URL，仍清除nodeRunId；筛选参数更新逻辑不变。
  导航pending期间不伪造另一套本地选择，受控旧默认导航迟到后可以收敛，最新导航提交后URL与选择一致。
- 详情effect依赖selectedRunId和workspace.id，cleanup令旧请求失效；成功、失败、finally三条路径都受guard。
  新请求清详情/错误，空选择清loading。旧请求成功不能覆盖新详情，旧失败/结束不能改新请求状态（源码核查）。
- 未修改后端、权限矩阵、Session/CSRF、租约计算、生产配置或运行状态；没有新增重试/外部动作。
  本结论只覆盖运行详情请求的Workspace生命周期，不冒称观测页全部overview/SLA/队列请求均已增加同类守卫。

## 证据

1. 导航回归：真实组件+真实MemoryRouter，仅延迟setter提交；旧默认导航晚于用户选择到达时，
   旧实现21次交替写入触发护栏，正式RED349ms；修复后GREEN215ms。
2. 详情回归：先悬置旧响应，切换并加载新详情后释放旧响应；旧实现URL指新运行但出现旧正文，
   RED209ms；修复后GREEN94ms。
3. 独立运行新2例与原12例：**2文件14例全部通过，4.32s**。fixture的9个原常量仅export/移动，
   已对HEAD逐字符核对数据不变，没有用改fixture降低旧断言要求。

20次导航护栏只在回归测试里捕捉无限振荡，不是产品截断策略。测试没有扩大超时或删除旧用例。
原始长期卡死未取得失败CPU profile，故本次证明并修复的是确定的导航振荡和详情串线，
不能据此声称全部历史卡死都只有这一个原因。完整分片、lint/build、浏览器与生产验收由主线程汇总。
