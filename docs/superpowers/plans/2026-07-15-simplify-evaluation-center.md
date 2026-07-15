# 评估中心简化实施计划

## 目标

把 `/w/:workspaceSlug/evaluations` 收敛为轻量的评估模板库，同时把现有评估历史、回归测试、整改任务等完整质量运营能力迁移到 `/w/:workspaceSlug/quality-operations`。现有 API、数据和历史能力均保留。

## 第一性原理核查

- 用户进入“评估中心”的首要任务是创建、维护、发布和停用可被工作流复用的评估模板。
- 运行评估、回归测试与整改闭环属于质量运营活动，不应抢占模板资产入口的主要认知空间。
- 必须保留 Rubric、版本、Model Provider、评估历史和整改任务的既有数据边界；本切片只调整信息架构与路由，不删除后端能力。
- 旧整改深链必须保留 `taskId`，否则已发送的通知与 Artifact 入口会失效。

## 实施步骤

1. **路由 RED**
   - 修改 `src/App.test.tsx`，断言工作区内存在 `quality-operations` 路由，且 `/evaluations?taskId=...`（含旧无工作区入口）会保留查询参数并跳转。
   - 运行 `npm test -- --run src/App.test.tsx`，确认因新路由缺失而失败。

2. **页面 RED**
   - 将现有 `src/pages/Evaluations.test.tsx` 重命名为 `src/pages/QualityOperations.test.tsx`，保持既有质量运营覆盖。
   - 新建 `src/pages/Evaluations.test.tsx`，覆盖轻量页面只加载 Rubric 与 Model Provider、创建/编辑/发布/停用/查看版本，并断言不加载评估历史、回归或整改 API。
   - 修改 `src/pages/Artifacts.test.tsx`，断言整改入口指向 `quality-operations?taskId=...`。
   - 运行上述三个测试文件，确认目标行为缺失。

3. **GREEN 实现**
   - 将旧 `src/pages/Evaluations.tsx` 重命名为 `src/pages/QualityOperations.tsx` 并调整导出名称。
   - 新建轻量 `src/pages/Evaluations.tsx`，仅调用 Rubric 与 Model Provider API；保留完整模板生命周期与版本查看。
   - 修改 `src/App.tsx`：新增次级路由；带 `taskId` 的评估中心入口跳转并保留查询参数；旧工作区重定向保留查询字符串。
   - 修改 `src/components/Layout.tsx` 增加次级页标题但不加入主导航。
   - 修改 `src/pages/Artifacts.tsx` 指向次级质量运营路由。
   - 逐项运行相关测试直至通过。

4. **验证与文档**
   - 运行相关 Vitest、`npm run lint`、`npm run build`。
   - 浏览器验证模板库、质量运营页、旧深链和 Artifact 整改入口。
   - 更新 Issue 02、项目概览与当前实现；记录对抗式审查结论。

5. **交付**
   - 审查 diff，提交并推送功能分支，创建 PR，核对 CI 与部署。
   - 再处理生产人验与其他 ready-for-human 缺口；凭证轮换按用户要求排除。

## 对抗式审查重点

- 新主页面不得暗中请求评估历史、回归测试或整改任务接口。
- 质量运营能力不得因页面搬迁而丢失测试覆盖或可访问性。
- `taskId` 深链不得在旧入口、工作区重定向或新路由中丢失。
- 次级页不得重新出现在主导航中造成信息架构回退。
- 文档不得把尚未完成的生产人工验收描述为已完成。
