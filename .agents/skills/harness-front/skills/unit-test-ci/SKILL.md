---
name: unit-test-ci-front
stage: ⑤ CI 与质量门禁
description: 机械化执行全量质量门禁——静态分析、架构约束、全量测试、安全扫描
---

# CI 与质量门禁技能（unit-test-ci）— 前端版

> **流水线阶段**: ⑤ 第五步
> **输入**: 通过 ④ 评审的完整变更
> **出口门禁**: 所有 CI 阶段全绿

### 核心规则（一句话摘要）

> **机械化执行：lint → 类型检查 → 架构约束 → 单元测试+覆盖率 → 构建。任一检查失败即红灯，不放过。**

---

## 1. CI 流水线

```bash
# Step 1: Lint 检查
{{LINT_CMD}}

# Step 2: TypeScript 类型检查
{{TYPE_CHECK_CMD}}

# Step 3: 单元测试 + 覆盖率
{{TEST_CMD}} {{COV_CMD}}

# Step 4: 构建检查
{{BUILD_CMD}}
```

## 2. 门禁标准

| 检查项 | 命令 | 通过标准 |
|--------|------|---------|
| Lint | `{{LINT_CMD}}` | 0 error, 0 warning |
| 类型检查 | `{{TYPE_CHECK_CMD}}` | 0 error |
| 单元测试 | `{{TEST_CMD}}` | 全部通过 |
| 覆盖率 | `{{TEST_CMD}} {{COV_CMD}}` | 核心逻辑 ≥80% |
| 构建 | `{{BUILD_CMD}}` | 成功输出 |

## 3. 失败处理

- 任一检查失败 → CI 红灯，更新 `change.md` 状态回退到 `fixing`
- 记录失败原因到 `.harness/changes/<id>/ci-report.md`
- 禁止在 CI 红灯状态下合并或发布

## 4. 完成标志

所有 CI 检查通过后，更新 `change.md` 状态 `ci → verifying`，进入 ⑥ 部署验证。