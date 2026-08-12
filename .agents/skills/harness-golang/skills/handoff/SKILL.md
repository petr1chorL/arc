---
name: handoff-golang
stage: 交接
description: 将当前对话的上下文压缩成交接文档，用于在另一个对话中无缝续接工作。
disable-model-invocation: true
---

# 上下文交接技能（Handoff）— Go 版

> 当前对话结束时，将工作上下文压缩为一份交接文档，下一个对话可以直接读取续接。

---

## 1. 工作流程

### Step 1: 收集上下文

| 信息来源 | 内容 |
|---------|------|
| `.harness/changes/<id>/change.md` | 当前变更状态 |
| `.harness/changes/<id>/review.md` | 最近的评审记录 |
| 对话历史 | 关键决策、未解决问题 |
| 当前代码变更 | 已修改但未提交的代码 |
| 编译/测试结果 | 最近的运行状态 |

### Step 2: 压缩交接文档

写入 `.harness/changes/<id>/handoff.md`，包含：

```markdown
# 交接文档: C-NNN

## 当前状态
- 状态: <draft/analyzing/coding/testing/reviewing/ci/verifying>

## 已完成的工作
- [x] ...

## 未完成的工作
- [ ] ...

## 关键决策
| 决策 | 依据 | 参与人 |
|------|------|--------|

## 未解决的问题
| 问题 | 需要谁决策 | 备注 |
|------|-----------|------|

## 上下文加载指令
1. 读取 `.harness/agents/owner.md`
2. 读取 `.harness/rules/`
3. 读取本文件
4. 读取 `.harness/changes/<id>/change.md`
5. `{{BUILD_CMD}}` — 检查编译状态
6. `{{TEST_CMD}}` — 检查测试状态

## 断点续接命令
```bash
{{BUILD_CMD}}
{{TEST_CMD}} {{RACE_DETECT_ARG}} ./...
```
```

### Step 3: 输出总结

> 📋 交接文档已写入 `.harness/changes/C-NNN/handoff.md`

---

## 2. 约束

- ❌ 禁止将硬编码密钥/Token/密码写入交接文档
- ❌ 禁止将对话中的无关内容写入
- ✅ 交接文档应保持简洁，只包含接续工作必需的信息