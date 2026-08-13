---
name: deploy-verify-golang
stage: ⑥ 部署验证
description: 部署后冒烟、健康检查、关键链路验证
---

# 部署验证技能（deploy-verify）— Go 版

> **流水线阶段**: ⑥ 第六步 · 收口
> **出口门禁**: 冒烟 + 健康检查通过，有回滚预案

### 核心规则（一句话摘要）

> **"CI 绿"不等于"线上可用"。确认健康检查 UP、核心链路通、降级链路通、有回滚预案。**

---

## 1. 工作流程

### Step 1: 准备环境
```bash
{{BUILD_CMD}} bin/server ./<service>/api/<service>.go
{{RUN_CMD}} -f etc/dev.yaml
```

### Step 2: 健康检查
```bash
{{HEALTH_CHECK_CMD}}          # 期望 UP
curl {{METRICS_ENDPOINT}}      # 指标可读
```

### Step 3: 冒烟测试（关键链路）
| 链路 | 验证点 |
|------|--------|
| 服务健康 | 健康检查端点 = UP |
| 核心 API | 端到端主链路返回预期结果 |
| 降级 | 模拟外部依赖故障，确认降级生效 |

### Step 4: 回滚预案
- 记录上一个稳定版本 tag / 镜像
- 明确回滚命令与触发条件

---

## 2. 输出格式（写入 verify.md）

```markdown
# ✅ 部署验证报告: C-NNN

## 健康检查
- [x] /health = UP

## 冒烟测试
| 链路 | 结果 |
|------|------|
| 核心 API | 🟢 |
| 降级 | 🟢 |

## 回滚预案
- 上一稳定版本: <tag>
- 回滚命令: <cmd>

## 结论
✅ 验证通过，变更可交付
```

---

## 3. 完成标志

验证通过 → 更新 `change.md` 状态 `verifying → done`。变更交付完成，同步相关 `.harness/wiki/` 文档。