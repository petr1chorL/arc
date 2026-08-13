---
name: deploy-verify-java
stage: ⑥ 部署验证
description: 部署后冒烟、健康检查、关键链路验证，确保变更在真实环境可用且可回滚
---

# 部署验证技能（deploy-verify）— Java 版

> **流水线阶段**: ⑥ 第六步 · 收口
> **输入**: 通过 ⑤ CI 的构建
> **产出**: `.harness/changes/<id>/verify.md`
> **出口门禁**: 冒烟 + 健康检查通过，有回滚预案

### 核心规则（一句话摘要）

> **"CI 绿"不等于"线上可用"。确认健康检查 UP、核心链路通、降级链路通、有回滚预案。**

---

## 1. 职责

你是上线把关人。确认变更在真实/类生产环境**真的能跑、关键链路真的通**，且出问题能快速回滚。"CI 绿"不等于"线上可用"。

---

## 2. 工作流程

### Step 1: 准备环境
```bash
{{BUILD_CMD}}   # 已在 CI 验过测试
java -jar <module>-server/target/*.jar --spring.profiles.active=dev
```

### Step 2: 健康检查
```bash
curl localhost:8080/actuator/health        # 期望 UP
curl localhost:8080/actuator/metrics       # 指标可读
```

### Step 3: 冒烟测试（关键链路）
| 链路 | 验证点 |
|------|--------|
| 服务健康 | 健康检查端点 = UP |
| 核心 API | 端到端主链路返回预期结果 |
| 降级 | 模拟外部依赖故障，确认降级生效 |

### Step 4: 可观测性核验
- 链路追踪有完整 trace
- 关键指标上报
- 日志为结构化 JSON，无敏感信息泄露

### Step 5: 回滚预案
- 记录上一个稳定版本 tag / 镜像
- 明确回滚命令与触发条件
- 确认无破坏性数据迁移

---

## 3. 输出格式（写入 verify.md）

```markdown
# ✅ 部署验证报告: C-NNN

## 环境
- profile: dev / 镜像: …

## 健康检查
- [x] /actuator/health = UP

## 冒烟测试
| 链路 | 结果 |
|------|------|
| 核心 API | 🟢 |
| 降级 | 🟢 |

## 回滚预案
- 上一稳定版本: <tag>
- 回滚命令: <cmd>

## 结论
✅ 验证通过，变更可交付 / ❌ 失败，退回 …
```

---

## 4. 完成标志

验证通过 → 更新 `change.md` 状态 `verifying → done`。变更交付完成，同步相关 `.harness/wiki/` 文档。