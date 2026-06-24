# Issue 管理方式

## 使用方式

本项目使用本地 Markdown 管理 PRD 和 Issue。

## 文件位置

```text
.scratch/<feature-slug>/
├─ PRD.md
├─ status.md
└─ issues/
   └─ NN-<slug>.md
```

`.scratch/` 是本地项目状态目录，不提交 Git。任务关闭前，需要把长期有效的
知识沉淀到 `CONTEXT.md`、`docs/`、测试或源代码中。

Issue 的讨论和处理历史追加在文件底部的 `## 处理记录（Comments）`。

## 操作约定

### 创建 Issue

1. 必要时创建功能目录。
2. 在 `issues/` 下创建下一个编号的 Markdown 文件。
3. 设置一个 `Category` 和一个 `Status`。
4. 链接所属 PRD。
5. 使用 `to-issues` 的端到端纵切模板。

### 列出 Issue

```powershell
Get-ChildItem .scratch -Recurse -Filter *.md
```

### 搜索 Issue

```powershell
rg -n "Status:|Category:|Acceptance criteria|ready-for-agent" .scratch
```

### 更新 Issue

只更新真实状态、已做决策、验收结果和验证证据，不删除有价值的历史信息。

### 关闭 Issue

满足以下条件后才能关闭：

- 验收标准全部确认。
- 已记录新的验证证据。
- 相关长期文档已更新。
- `status.md` 已指向下一项工作。

