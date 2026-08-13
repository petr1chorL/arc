---
name: unit-test-ci-golang
stage: ⑤ CI 与质量门禁
description: 机械化执行全量质量门禁——静态分析、竞态检测、架构约束、全量测试
---

# CI 与质量门禁技能（unit-test-ci）— Go 版

> **流水线阶段**: ⑤ 第五步
> **出口门禁**: 所有 CI 阶段全绿

### 核心规则（一句话摘要）

> **机械化执行：编译 → 竞态检测 → 架构约束 → 单元测试+覆盖率 → 安全扫描。任一检查失败即红灯。**

---

## 1. Go CI 流水线

```
stage-1  编译检查
  {{DEP_CMD}}
  {{BUILD_CMD}}

stage-2  静态分析
  {{VET_CMD}}
  {{LINT_CMD}}          # 包含 staticcheck + gocyclo + funlen 等

stage-3  架构约束
  {{ARCH_TEST_CMD}}   # 自定义架构约束测试

stage-4  单元测试 + 覆盖率 + 竞态检测
  {{TEST_CMD}} {{RACE_DETECT_ARG}} -cover -coverprofile=coverage.out ./...
  go tool cover -func=coverage.out | grep "total" | awk '{print $3}' | cut -d'.' -f1
  # 要求: 核心逻辑覆盖率 ≥80%

stage-5  集成测试（PR 时）
  {{INTEGRATION_CMD}}
```

---

## 2. 门禁判定表

| 检查项 | 通过标准 | 失败处理 |
|--------|---------|---------|
| go build | 0 error | 退回 ② 编码 |
| go vet | 0 warning | 退回 ② 编码 |
| {{LINT_TOOL}} | 0 error | 退回 ② 编码 |
| 竞态检测 | 0 data race | 退回 ②（严重） |
| 单元测试 | 0 failed | 退回 ② / ③ |
| 覆盖率 | 核心 ≥80% | 退回 ③ 补测试 |

---

## 3. 完成标志

全绿 → 更新 `change.md` 状态 `ci → verifying`，进入 ⑥ 部署验证。