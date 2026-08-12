---
name: unit-test-write-front
stage: ③ 单元测试编写
description: 为实现代码编写 Vue 前端单元测试，核心逻辑覆盖率 ≥80%，覆盖 AC 与边界
---

# 单元测试编写技能（unit-test-write）— 前端版

> **流水线阶段**: ③ 第三步
> **输入**: ② 阶段的实现代码 + change.md
> **出口门禁**: 测试通过 · 核心逻辑覆盖率 ≥80% · 覆盖全部 AC、边界与降级路径
> **测试框架**: {{TEST_FRAMEWORK}} + {{UTIL_LIB}} + {{ENV_LIB}}

### 核心规则（一句话摘要）

> **每条 AC 至少一个测试，每条降级路径一个专门测试，核心覆盖率 ≥80%。禁止只测 happy path。**

---

## 1. 职责

你负责编写测试，确保核心逻辑没有遗漏。测试即文档，每条 AC 至少有一个对应的测试用例，每条降级路径至少有一个专门的测试用例。

---

## 2. 工作流程

### Step 1: 梳理测试矩阵
从 `change.md` 提取所有 AC 与边界情况，建立"测试点 → 测试用例"映射表，确保无遗漏。

### Step 2: 分层测试
| 层级 | 内容 |
|------|------|
| Spec Tests | 每条 AC 的 happy path / 核心行为 |
| Boundary Tests | 空/零值、极值、边界输入 |
| Failure/Fallback Tests | API 故障时的降级逻辑（超时/空返回/错误码） |
| Regression Tests | 已修复 bug / 历史故障回归 |

### Step 3: 编写测试
- 命名: `should_<期望>_when_<条件>`
- 用 `describe` 组织测试套件，`it` 组织测试用例
- 组件测试用 `{{UTIL_LIB}}.mount` / `{{UTIL_LIB}}.shallowMount`，props 用 `props` 选项传入
- Store 测试用 `setActive{{STATE_MGMT_LIB}}(create{{STATE_MGMT_LIB}}())`
- 异步测试用 `flushPromises` 等待 DOM 更新

### Step 4: Mock 策略
- 用 `{{TEST_FRAMEWORK}}.mock` Mock 外部依赖（API 请求、第三方库）
- 用 `{{TEST_FRAMEWORK}}.fn()` 提供 stub 函数
- 禁止 Mock `{{UTIL_LIB}}` 或 `vue` 本身

### Step 5: 覆盖率核验
- 跑 `{{TEST_CMD}} {{COV_CMD}}`，核心逻辑 ≥80%
- 覆盖率不足 → 补测试，而非降低标准
- 纯 UI 展示组件、路由配置、类型定义可豁免

### Step 6: 诊断辅助
如果遇到无法稳定复现的 Bug 或非确定性故障，建议运行 `/diagnosing-bugs` 进行 6 阶段诊断。
诊断结果记录到 `.harness/changes/<id>/diagnosis.md`。

---

## 3. 测试质量红线

- ❌ 只测 happy path，边界靠注释"应该能处理"
- ❌ 断言空泛（`expect(true).toBe(true)` 当主断言）
- ❌ 测试间相互依赖、有顺序耦合
- ❌ Mock 自己写的业务逻辑（那样测的是 Mock 不是逻辑）
- ✅ 每条 AC 至少一个测试
- ✅ 每条降级路径至少一个专门测试

---

## 4. 完成标志

测试通过、覆盖率达标、测试矩阵完整后，更新 `change.md` 状态 `testing → reviewing`，进入 ④ 专家评审。