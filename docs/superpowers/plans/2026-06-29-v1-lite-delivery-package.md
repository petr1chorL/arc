# V1 Lite Delivery Package Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the V1.0 Lite delivery package so business users and admins can run and accept the pilot without developer narration.

**Architecture:** This is a documentation slice. It creates user-facing and admin-facing guides, keeps local PRD/Issue planning in `.scratch`, and links the delivery package from the V1.0 Lite entry points.

**Tech Stack:** Markdown, local `.scratch` issue tracker, Git diff verification.

---

### Task 1: Local PRD and Issue

**Files:**
- Create: `.scratch/v1-lite-delivery-package/PRD.md`
- Create: `.scratch/v1-lite-delivery-package/issues/01-pilot-delivery-package.md`

- [ ] **Step 1: Write PRD**

Include problem statement, first-principles check, solution, user stories, implementation decisions, testing decisions, adversarial review, and out-of-scope items.

- [ ] **Step 2: Write Issue**

Create one `ready-for-agent` issue covering user guide, admin guide, issue log, evidence IDs, links, and `git diff --check`.

### Task 2: Delivery Documents

**Files:**
- Create: `docs/V1_LITE_USER_GUIDE.md`
- Create: `docs/V1_LITE_ADMIN_ACCEPTANCE_GUIDE.md`
- Create: `docs/V1_LITE_PILOT_ISSUE_LOG.md`

- [ ] **Step 1: Write user guide**

Cover login, Workspace selection, asset confirmation, workflow run, human review, evaluation, observability, and completion evidence.

- [ ] **Step 2: Write admin acceptance guide**

Cover environment readiness, account and permission checks, asset readiness, run evidence, security boundaries, and signoff criteria.

- [ ] **Step 3: Write issue log template**

Cover severity, category, owner, evidence, reproduction, workaround, retest evidence, and whether the issue is blocking V1.0 Lite.

### Task 3: Link Entry Points

**Files:**
- Modify: `README.md`
- Modify: `docs/V1_LITE_LAUNCH_PLAN.md`

- [ ] **Step 1: Link README**

Add the three delivery documents to the V1.0 Lite document list.

- [ ] **Step 2: Link launch plan**

Under V1L-E, add the three current delivery documents and update the current next step to run acceptance using the delivery package.

### Task 4: Verification and Commit

**Files:**
- Verify all files from Tasks 1-3.

- [ ] **Step 1: Search required evidence fields**

Run: `Select-String -Path docs\V1_LITE_USER_GUIDE.md,docs\V1_LITE_ADMIN_ACCEPTANCE_GUIDE.md,docs\V1_LITE_PILOT_ISSUE_LOG.md -Pattern "Run ID","Human Task ID","Evaluation ID","Trace ID"`

Expected: required evidence fields appear in the delivery package.

- [ ] **Step 2: Search entry links**

Run: `Select-String -Path README.md,docs\V1_LITE_LAUNCH_PLAN.md -Pattern "V1_LITE_USER_GUIDE","V1_LITE_ADMIN_ACCEPTANCE_GUIDE","V1_LITE_PILOT_ISSUE_LOG"`

Expected: README and launch plan reference the delivery package.

- [ ] **Step 3: Run diff check**

Run: `git diff --check`

Expected: exit code 0.

- [ ] **Step 4: Stage durable docs only**

Run: `git add README.md docs\V1_LITE_LAUNCH_PLAN.md docs\V1_LITE_USER_GUIDE.md docs\V1_LITE_ADMIN_ACCEPTANCE_GUIDE.md docs\V1_LITE_PILOT_ISSUE_LOG.md docs\superpowers\plans\2026-06-29-v1-lite-delivery-package.md`

Expected: `.scratch` files are not staged.

- [ ] **Step 5: Commit**

Run: `git commit -m "docs: add v1 lite delivery package"`

Expected: commit succeeds.
