---
name: unit-test-write-golang
stage: ③ 单元测试编写
description: 为实现代码编写 Go 单元测试，核心逻辑覆盖率 ≥80%，覆盖 AC 与边界
---

# 单元测试编写技能（unit-test-write）— Go 版

> **流水线阶段**: ③ 第三步
> **出口门禁**: 测试通过 · 核心逻辑覆盖率 ≥80% · 覆盖全部 AC、边界与降级路径
> **测试框架**: {{TEST_FRAMEWORK}}

### 核心规则（一句话摘要）

> **每条 AC 至少一个测试，每条降级路径一个专门测试，核心覆盖率 ≥80%。禁止只测 happy path。**

---

## 1. 职责

你是测试驱动质量的工程师。编码前让失败测试先存在，编码后补齐边界、降级、回归测试。

---

## 2. 工作流程

### Step 1: 梳理测试矩阵
从 `change.md` 提取所有 AC 与边界情况，建立"测试点 → 测试用例"映射表。

### Step 2: 分层测试
| 层级 | 内容 |
|------|------|
| Spec Tests | 每条 AC 的 happy path / 核心行为 |
| Boundary Tests | 空/零值、极值、并发、重复执行 |
| Failure/Fallback Tests | 依赖故障时的降级逻辑 |
| Regression Tests | 已修复 bug / 历史故障回归 |

### Step 3: 编写测试
- 命名: `Test<函数名>_<场景>` 或 `Test_<期望>_<条件>`
- 用 `testing` 包 + `{{ASSERT_LIB}}/assert` 和 `{{ASSERT_LIB}}/require`
- 每个测试**单一断言意图**，Arrange-Act-Assert 三段清晰
- 用 `{{ASSERT_LIB}}/suite` 组织分组测试（可选）

### Step 4: Mock 原则
- 用接口抽象外部依赖，用 mock 实现（如 `{{MOCK_LIB}}` 或手动 mock）
- **禁止 Mock 自己写的业务类**
- 用 `{{HTTP_MOCK_UTIL}}` 模拟 HTTP 外部服务

### Step 5: 覆盖率核验
- 跑 `{{COV_CMD}}<service>/...`，核心逻辑 ≥80%
- 跑 `{{TEST_CMD}} {{RACE_DETECT_ARG}}` 检测竞态

### Step 6: 诊断辅助
如果遇到无法稳定复现的 Bug 或非确定性故障，建议运行 `/diagnosing-bugs` 进行 6 阶段诊断。
诊断结果记录到 `.harness/changes/<id>/diagnosis.md`。

---

## 3. 测试质量红线

- ❌ 只测 happy path，边界靠注释"应该能处理"
- ❌ 测试间相互依赖、有顺序耦合
- ❌ Mock 自己写的类
- ✅ 每条 AC 至少一个测试
- ✅ 每个边界情况至少一个测试
- ✅ 降级逻辑有专门测试

---

## 4. 示例

```go
func TestCheck_ShouldTriggerHITL_WhenBudgetOverrunExceeds15Percent(t *testing.T) {
    plan := planWithCost(11500)
    result := budgetService.Check(context.Background(), plan)
    assert.True(t, result.RequiresHumanIntervention)
}

func TestPlan_ShouldReturnFallback_WhenMapAPITimeout(t *testing.T) {
    mockClient := new(MockMapClient)
    mockClient.On("Distance", mock.Anything, mock.Anything).
        Return(nil, context.DeadlineExceeded)
    svc := NewRouteService(mockClient)
    result, err := svc.Plan(context.Background(), req)
    assert.NoError(t, err)
    assert.True(t, result.IsFallback)
}
```

---

## 5. 完成标志

`{{TEST_CMD}} {{RACE_DETECT_ARG}}` + `{{COV_CMD}}` 全绿 + 覆盖率达标 → 更新 `change.md` 状态 `testing → reviewing`。