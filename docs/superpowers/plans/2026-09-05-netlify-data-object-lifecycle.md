# 04C Data Object 生命周期实施计划

设计：`../specs/2026-09-05-netlify-data-object-design.md`，用户已确认。
目标：刷新后读取不可变 Schema 历史，保持双栈治理契约；不扩展运行时 Schema 引擎。

## 1. Python 历史读取示踪切片

- 编辑 `apps/api/tests/test_data_object_definitions_api.py`：创建→发布→PATCH→再次发布→GET versions，
  比较完整发布响应、倒序和独立 Session 持久化；覆盖空列表、不存在/跨空间定义。
- 运行 `apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests/test_data_object_definitions_api.py -q -o addopts='' -p no:cacheprovider`。
  先确认新增测试因 GET 缺失而失败。
- 在现有 `apps/api/app/main.py` 的 Data Object 路由接缝补最小 GET，复用 workspace_context、
  asset.read 和定义作用域检查；不在本轮顺手搬迁已有四条路由。
- 下一轮聚焦测试覆盖非法历史结构固定 409，再实现边界校验；原始持久化值不得变更。

## 2. 双栈契约与事务

- 新增 `fixtures/data-object-requests.json` 和 `scripts/data-object-contract-python.py`，重放设计里的
  五条路由、别名/额外字段、缺省/null、固定错误；比较实际 HTTP JSON，只规范化 ID/时间。
- 新增 `netlify/functions/_shared/data-objects/{routes,handler,policy,postgres}.ts`，复用身份事务层，
  每个行为先在 `scripts/data-objects.test.mjs` / `scripts/test-data-objects-postgres.mjs` 建立 RED。
- 依次实现解析/作用域读取、创建编辑、行锁发布与历史读取。合成 PG 覆盖四角色五路由、
  两 Session 并发、名称竞争、版本冲突、审计回滚、独立连接确认。仅清理自身随机 schema。
- `netlify/functions/data-objects.mts` 无公共 path；不匹配路由在读取环境或连接数据库前 404。

## 3. 页面闭环

- `src/api/dataObjects.ts` 增加现有五字段版本类型和列表封装。
- `src/pages/DataObjects.test.tsx` 先测试历史加载、错误重试和草稿不冒充快照，
  再在 `src/pages/DataObjects.tsx` 添加只读历史入口。
- 在 `scripts/reference-assets-e2e-server.mjs` 接入 Data Object；扩展迁移能力标识与合成浏览器覆盖，
  两次发布后刷新比较两版 Schema，阻断外域和未迁移执行请求。

## 4. 验证与对抗审查

- 快速相关测试后运行全量 pytest、`npm test -- --run --maxWorkers=2`、`npm run lint`、
  `npm run build`、`npm run deploy:check`，现有身份/资产/Agent PG 和同库 Playwright 回归。
- 审查权限、事务、历史篡改、错误回显、测试假阳性；记录 `.harness/changes/netlify-data-object-lifecycle/verify.md`。
- 更新 Issue 和项目总览；未通过的验收保持未勾选，不将本地工程通过标为生产迁移完成。
