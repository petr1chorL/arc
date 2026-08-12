# 验证回执

## 本地门禁

| 影响面 | 命令 | 结果 |
|---|---|---|
| 前端测试 | `npm test -- --run` | |
| 后端测试 | `apps/api/.venv/Scripts/python.exe -m pytest apps/api/tests -q` | |
| Lint | `npm run lint` | |
| Build | `npm run build` | |
| 部署契约 | `npm run deploy:check` | |
| E2E（适用时） | `npm run test:e2e` | |
| Diff | `git diff --check` | |

删除不适用行并说明原因，不得把未运行项写成通过。

## 浏览器/部署证据

- 不适用 / <环境、路径、结果>

## 第一性原理复核

- 当前变更是否仍是最小必要切片：

## 对抗式复核

- 错误完成感：
- 权限/审计/隔离/安全：
- 关键失败路径：
- 文档夸大风险：

## 结论

- 工程验证：通过 / 未通过
- 人工或生产签收：不适用 / 待完成 / 已完成（附证据）
