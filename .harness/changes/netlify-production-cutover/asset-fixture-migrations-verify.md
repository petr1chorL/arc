# 资产验证库结构迁移：回执

日期：2026-09-06。本地修复，不等同云端全门禁通过或生产迁移完成。

## 新CI的准确结论

- 0a35e929 / CI34025277781：前端第3分片长时间未结束，最终Worker异常退出；不是全绿。
- 52e36f8 / CI34025942754：前端71文件696项、Python后端和身份PG步骤通过；
  随后资产PG步骤在 invocation history 的200断言处得到503，因此本次CI总体失败。
- 52e36f8的Netlify部署6a9d384db0edd50008568d57被credit usage exceeded跳过。
  当前发布仍b626602；匿名只读首页200/ARC.ONE标题、api/health200/status ok，原生runtime/scheduled404。
  没有付费、重试部署或切换代理。

## 直接原因与修复

原脚本仅加载baseline/rate-limit两条结构迁移；新的历史关联查询依赖runtime_operations和Tool快照。
原命令在专属本地PG稳定复现503/200，PG日志明确 `relation "runtime_operations" does not exist`。
从runtime-test-db.mjs抽出原有排序、排除seed的结构加载函数，原生fixture、资产PG脚本及资产浏览器
fixture复用。没有吞掉缺表错误、跳过历史合同或修改业务查询，其他独立域的基线测试保留原范围。

## 本地验证

- 原命令RED；结构修复后原失败点通过，但默认Python缺pydantic_settings，根.venv缺argon2。
  改用既有API虚拟环境，不安装依赖、不跳过共享回放：
  `node --experimental-transform-types scripts/test-reference-assets-postgres.mjs 55433 apps/api/.venv/Scripts/python.exe`。
  **198检查、52角色路由检查、26共享请求契约 matched，PASS**。
- `ARC_RUNTIME_TEST_PORT=55433` + `node scripts/verify-runtime-local.mjs`：**22程序 PASS**。
- `ARC_ONE_TEST_PG_PORT=55433` + Playwright reference-assets配置：**9浏览器场景 PASS，24.5s**；
  包含非空引用与隐藏调用历史，不是只验证页面空态。
- lint/build/typecheck/deploy:check/diff check PASS。本次只改测试设施，未重复已通过的全部前端/Python测试。
- 独立复审0阻断；无DB spy核对8条结构迁移的顺序/内容与抽取前一致，seed排除且query错误立即原样传播。
  其他实际历史调用方已使用完整runtime fixture，没有通过扩大无关测试或放宽断言来消除失败；见独立review。
- 专属容器arc-one-asset-fixture-verify-20260906仅绑定loopback、PG17/tmpfs；全部测试后非系统schema为空，
  已停止并由--rm移除。两次Python环境失败也走finally清理，未接触真实业务库或其他容器。

生产原生入口仍关闭；恢复Netlify额度、源备份/独立恢复/对账、公开宿主接线及真实业务验收仍未完成。
本回执不为后续提交预报CI成功；后续精确提交和云端结论须另行核验。
