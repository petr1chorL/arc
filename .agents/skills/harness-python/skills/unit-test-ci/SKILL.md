---
name: unit-test-ci-python
stage: ⑤ CI 与质量门禁
description: 机械化执行全量质量门禁——静态分析、架构约束、全量测试
---

# CI 与质量门禁技能（unit-test-ci）— Python 版

> **流水线阶段**: ⑤ 第五步
> **出口门禁**: 所有 CI 阶段全绿

### 核心规则（一句话摘要）

> **机械化执行：语法检查 → 架构约束 → 单元测试+覆盖率 → 安全扫描。任一检查失败即红灯。**

---

## 1. CI 流水线

```
stage-1  语法/风格检查
  {{LINT_CMD}}
  {{TYPE_CHECK_TOOL}} <app_package>/
  {{FORMAT_CHECK_CMD}}

stage-2  架构约束
  {{ARCH_TEST_CMD}}

stage-3  单元测试 + 覆盖率
  {{COV_CMD}}=<app_package> --cov-fail-under=80 -v

stage-4  安全扫描
  扫描硬编码密钥
  检查依赖漏洞（{{SECURITY_CMD}}）

stage-5  集成测试（PR 时）
  {{INTEGRATION_CMD}}
```

---

## 2. 门禁判定表

| 检查项 | 通过标准 | 失败处理 |
|--------|---------|---------|
| {{LINT_CMD}} | 0 violation | 退回 ② 编码 |
| {{TYPE_CHECK_TOOL}} | 0 type error | 退回 ② 编码 |
| {{FORMAT_TOOL}} | 格式一致 | 退回 ② 编码 |
| 单元测试 | 0 failed | 退回 ② / ③ |
| 覆盖率 | 核心 ≥80% | 退回 ③ 补测试 |
| 安全扫描 | 0 命中 | 退回 ② |

---

## 3. 完成标志

全绿 → 更新 `change.md` 状态 `ci → verifying`，进入 ⑥ 部署验证。