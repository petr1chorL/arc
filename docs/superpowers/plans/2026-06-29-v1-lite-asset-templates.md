# V1 Lite Asset Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the V1.0 Lite pilot asset template package so a user can manually configure the default pilot workflow.

**Architecture:** This is a documentation and delivery-package slice. It adds one durable template package, one local PRD, one local Issue, and links the package from the V1.0 Lite launch docs.

**Tech Stack:** Markdown, local `.scratch` issue tracker, Git diff verification.

---

### Task 1: Local PRD and Issue

**Files:**
- Create: `.scratch/v1-lite-asset-templates/PRD.md`
- Create: `.scratch/v1-lite-asset-templates/issues/01-pilot-asset-template-pack.md`

- [ ] **Step 1: Write PRD**

Create a PRD that states the problem, first-principles check, solution, user stories, implementation decisions, testing decisions, adversarial review, and out-of-scope boundaries.

- [ ] **Step 2: Write Issue**

Create one `ready-for-agent` issue for the template package. The issue must include acceptance criteria for Agent, Workflow, Rubric, Golden Set, doc links, and `git diff --check`.

- [ ] **Step 3: Inspect local planning files**

Run: `Get-ChildItem .scratch\v1-lite-asset-templates -Recurse`

Expected: the PRD and issue file are present.

### Task 2: Durable Asset Template Document

**Files:**
- Create: `docs/V1_LITE_ASSET_TEMPLATES.md`

- [ ] **Step 1: Add template package**

Write a Markdown document containing:

- pilot asset inventory
- structured input and output schemas
- four Agent templates
- Workflow node and edge template
- Human Review template
- Rubric template
- Golden Set samples
- setup checklist

- [ ] **Step 2: Run content coverage check**

Run: `Select-String -Path docs\V1_LITE_ASSET_TEMPLATES.md -Pattern "Agent 1","Workflow","Rubric","Golden Set","Human Review"`

Expected: each pattern appears at least once.

### Task 3: Link V1.0 Lite Docs

**Files:**
- Modify: `docs/V1_LITE_LAUNCH_PLAN.md`
- Modify: `README.md`

- [ ] **Step 1: Update launch plan**

Under V1L-B, add `docs/V1_LITE_ASSET_TEMPLATES.md` as the current template package.

- [ ] **Step 2: Update README**

Add the V1.0 Lite asset template package to the V1.0 Lite document list.

- [ ] **Step 3: Run link check by search**

Run: `Select-String -Path README.md,docs\V1_LITE_LAUNCH_PLAN.md -Pattern "V1_LITE_ASSET_TEMPLATES"`

Expected: both files reference the template package.

### Task 4: Verification and Commit

**Files:**
- Verify all files from Tasks 1-3.

- [ ] **Step 1: Run diff check**

Run: `git diff --check`

Expected: exit code 0.

- [ ] **Step 2: Review changed files**

Run: `git status --short`

Expected: durable docs are tracked changes; `.scratch` files may remain untracked and must not be committed.

- [ ] **Step 3: Stage durable docs only**

Run: `git add README.md docs\V1_LITE_LAUNCH_PLAN.md docs\V1_LITE_ASSET_TEMPLATES.md docs\superpowers\plans\2026-06-29-v1-lite-asset-templates.md`

Expected: `.scratch` files are not staged.

- [ ] **Step 4: Commit**

Run: `git commit -m "docs: add v1 lite asset templates"`

Expected: commit succeeds.
