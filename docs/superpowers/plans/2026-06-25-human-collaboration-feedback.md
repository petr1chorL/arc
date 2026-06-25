# V0.6 Human Collaboration and Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a persistent Human Task workflow that pauses and resumes Workflow Runs, supports assignment, countersign, SLA escalation, artifact editing, feedback candidates, and expert-confirmed Golden Samples.

**Architecture:** Add focused SQLAlchemy records and services around the existing synchronous `ExecutionService`. Human nodes persist a task and stop execution; `WorkflowResumeService` reconstructs the published workflow snapshot and resumes from a defined node. FastAPI exposes typed task, directory, decision, and feedback APIs; React replaces the basic review page with the approved three-pane workbench.

**Tech Stack:** Python 3.12, FastAPI, Pydantic, SQLAlchemy, SQLite/PostgreSQL-compatible models, Pytest, React 19, TypeScript, Vite, Vitest, Testing Library, Lucide React, native Fetch API, Playwright/browser control.

---

## File Map

### Backend

- Modify `apps/api/app/models.py`: add Reviewer, ReviewGroup, group membership, HumanTask, participant snapshot, ReviewDecision, ArtifactVersion, ArtifactDiff, AuditEvent, NotificationOutbox, ResumeRequest, FeedbackCandidate, and GoldenSample records.
- Modify `apps/api/app/schemas.py`: add typed request/response contracts for directories, tasks, assignment, decisions, audits, feedback, and golden samples.
- Create `apps/api/app/human_tasks.py`: own assignment, claim, transfer, countersign, SLA refresh, decision validation, artifact versioning, audit, and Outbox rules.
- Modify `apps/api/app/execution.py`: pause at Human nodes and expose resume, rerun, reject, and completion helpers without duplicating Agent execution.
- Modify `apps/api/app/main.py`: compose services and expose Human Task, directory, resume retry, feedback, and Golden Sample routes.
- Modify `apps/api/app/migrations.py`: add only the SQLite compatibility migration required by new columns on existing tables; new tables remain managed by metadata creation.
- Create `apps/api/tests/test_human_task_api.py`: verify task persistence, assignment, countersign, conflicts, SLA, feedback, and expert confirmation through the API.
- Create `apps/api/tests/test_human_workflow_execution.py`: verify pause, continue, modify-and-continue, rerun, reject, and resume retry with FakeGateway.

### Frontend

- Modify `src/types.ts`: replace the basic HumanReview contract with HumanTask, reviewer directory, decision, artifact version, audit, feedback, and Golden Sample contracts.
- Create `src/api/humanTasks.ts`: typed Fetch client for all V0.6 Human Task and feedback endpoints.
- Modify `src/pages/Reviews.tsx`: implement the three-pane review workbench, mobile segmented view, claim/transfer, edit/Diff, four decisions, countersign, SLA, audit, feedback, and expert confirmation.
- Modify `src/pages/Reviews.test.tsx`: cover queue loading, validation, claim, transfer, modification, decisions, SLA display, conflicts, and Golden Sample confirmation.
- Modify `src/pages/Workflows.tsx`: allow Human nodes to configure assignment, review policy, participants, SLA, and escalation group using existing node `data`.
- Modify `src/pages/Workflows.test.tsx`: verify Human node configuration is serialized into the workflow contract.
- Modify `src/components/Layout.tsx`: source the navigation review count from Human Tasks.
- Modify `src/components/Layout.test.tsx`: verify the Human Task count endpoint and error fallback.
- Modify `src/components/StatusBadge.tsx`: map new task and SLA statuses.
- Modify `src/index.css`: add the three-pane workbench, Diff, timeline, countersign, dialog, and mobile segmented layout styles.

### Project State

- Modify `.scratch/human-collaboration-feedback/issues/*.md`: record RED/GREEN and final verification evidence, then check acceptance criteria.
- Modify `.scratch/human-collaboration-feedback/status.md`: record completion and commands.
- Modify `docs/CURRENT_IMPLEMENTATION.md`: describe only verified V0.6 behavior and remaining limits.
- Modify `package.json` only if a dedicated non-watch test script is needed; prefer existing scripts.

## Task 0: Preserve the Verified V0.5 Baseline

**Files:**
- Stage: existing V0.5 files shown by `git status --short`
- Verify: `apps/api/tests/test_execution_api.py`
- Verify: `src/pages/Reviews.test.tsx`

- [ ] **Step 1: Run the current V0.5 backend suite**

Run:

```powershell
Set-Location apps/api
python -m pytest
```

Expected: all existing backend tests pass without reading or printing `.env`.

- [ ] **Step 2: Run the current V0.5 frontend suite**

Run:

```powershell
Set-Location D:\project\安克知识沉淀
npm test -- --run
```

Expected: all existing Vitest tests pass.

- [ ] **Step 3: Run the current static checks**

Run:

```powershell
npm run lint
npm run build
```

Expected: both commands exit with code 0.

- [ ] **Step 4: Commit only the V0.5 implementation**

Run:

```powershell
git add apps/api src docs/CURRENT_IMPLEMENTATION.md docs/superpowers/plans/2026-06-24-real-agent-execution.md docs/superpowers/specs/2026-06-24-real-agent-execution-design.md
git diff --cached --name-only
git commit -m "feat: execute published agents and workflows"
```

Expected: the commit contains V0.5 implementation and documentation, while `.scratch`, `.superpowers`, local database files, and `.env` remain untracked or ignored.

## Task 1: Pause Workflows at Human Nodes and Persist Human Tasks

**Files:**
- Create: `apps/api/tests/test_human_workflow_execution.py`
- Modify: `apps/api/app/models.py`
- Modify: `apps/api/app/schemas.py`
- Create: `apps/api/app/human_tasks.py`
- Modify: `apps/api/app/execution.py`
- Modify: `apps/api/app/main.py`

- [ ] **Step 1: Write the failing workflow pause test**

Add a test that publishes a workflow shaped as `trigger -> agent -> human -> end`, executes it with `FakeGateway`, then asserts:

```python
assert response.status_code == 201
run = response.json()
assert run["status"] == "等待审核"
assert [node["nodeType"] for node in run["nodes"]] == ["trigger", "agent", "human"]
assert run["nodes"][-1]["status"] == "等待审核"
tasks = client.get("/api/human-tasks").json()
assert len(tasks) == 1
assert tasks[0]["workflowRunId"] == run["id"]
assert tasks[0]["sourceNodeId"] == "agent-1"
```

- [ ] **Step 2: Run the focused test and capture RED**

Run:

```powershell
Set-Location apps/api
python -m pytest tests/test_human_workflow_execution.py::test_human_node_pauses_workflow_and_creates_task -q
```

Expected: FAIL because Human nodes currently pass through and `/api/human-tasks` does not exist.

- [ ] **Step 3: Add minimal persistence records**

Define records with explicit string statuses:

```python
class HumanTaskRecord(Base):
    __tablename__ = "human_tasks"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    workflow_run_id: Mapped[str] = mapped_column(String(36), index=True)
    node_run_id: Mapped[str] = mapped_column(String(36), unique=True)
    human_node_id: Mapped[str] = mapped_column(String(120))
    source_node_id: Mapped[str] = mapped_column(String(120))
    artifact_version_id: Mapped[str] = mapped_column(String(36))
    status: Mapped[str] = mapped_column(String(32), default="待认领")
    assignment_type: Mapped[str] = mapped_column(String(32), default="group_claim")
    review_policy: Mapped[str] = mapped_column(String(32), default="any_one")
    required_approvals: Mapped[int] = mapped_column(Integer, default=1)
    participant_snapshot: Mapped[list[str]] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
```

Also add `ArtifactVersionRecord` linked to the existing `ArtifactRecord`.

- [ ] **Step 4: Implement Human node pause**

In `ExecutionService.run_workflow_version`, replace Human-node passthrough with a call to:

```python
human_task_service.pause_for_review(
    session=session,
    run=run,
    workflow_snapshot=snapshot,
    node=node,
    node_input=node_input,
    source_node_id=predecessors[node_id][-1],
)
```

The service creates the Human `NodeRun`, root Artifact plus version, HumanTask, sets `run.status = "等待审核"`, commits, and returns immediately without executing downstream nodes.

- [ ] **Step 5: Expose task list and detail endpoints**

Implement:

```python
@app.get("/api/human-tasks", response_model=list[HumanTaskRead])
@app.get("/api/human-tasks/{task_id}", response_model=HumanTaskDetailRead)
```

The detail includes current artifact, run context, approval progress, and audit events.

- [ ] **Step 6: Run the focused test and capture GREEN**

Run:

```powershell
python -m pytest tests/test_human_workflow_execution.py::test_human_node_pauses_workflow_and_creates_task -q
```

Expected: PASS.

- [ ] **Step 7: Commit the vertical slice**

Run:

```powershell
git add apps/api/app apps/api/tests/test_human_workflow_execution.py
git commit -m "feat: pause workflows for human tasks"
```

## Task 2: Add Reviewer Directory, Assignment, Claim, Transfer, and Countersign

**Files:**
- Create: `apps/api/tests/test_human_task_api.py`
- Modify: `apps/api/app/models.py`
- Modify: `apps/api/app/schemas.py`
- Modify: `apps/api/app/human_tasks.py`
- Modify: `apps/api/app/main.py`

- [ ] **Step 1: Write failing API tests for directory and assignment**

Create tests that seed reviewers and groups through service fixtures, then verify:

```python
assert client.get("/api/reviewers").status_code == 200
assert client.get("/api/review-groups").status_code == 200
claim = client.post(
    f"/api/human-tasks/{task_id}/claim",
    json={"reviewerId": reviewer_id},
)
assert claim.status_code == 200
assert claim.json()["assigneeReviewerId"] == reviewer_id
```

Add a second claim assertion expecting `409`, and transfer assertions for reviewer and group targets.

- [ ] **Step 2: Run assignment tests and capture RED**

Run:

```powershell
python -m pytest tests/test_human_task_api.py -k "directory or claim or transfer" -q
```

Expected: FAIL because directory and assignment routes do not exist.

- [ ] **Step 3: Implement reviewer and group records**

Add `ReviewerRecord`, `ReviewGroupRecord`, and `ReviewGroupMemberRecord`. Reviewer fields include `name`, `role`, `is_expert`, and `is_active`; group fields include `name`, `assignment_mode`, `rotation_cursor`, and `is_escalation_group`.

Expose list endpoints and seed a small deterministic local directory only when the tables are empty:

```text
产品审核组: 林晓(审核人), 陈卓(专家)
升级审核组: 周宁(审核负责人)
```

- [ ] **Step 4: Implement claim and transfer rules**

Add service methods:

```python
claim_task(session, task_id, reviewer_id)
transfer_task(session, task_id, actor_id, reviewer_id=None, group_id=None, reason="")
```

Both methods verify active membership, reject terminal tasks, update status and assignment, and append `AuditEventRecord`.

- [ ] **Step 5: Write and run failing countersign tests**

Parametrize `any_one`, `all`, and `threshold`:

```python
@pytest.mark.parametrize(
    ("policy", "required", "decisions", "expected_terminal"),
    [
        ("any_one", 1, ["approve"], True),
        ("all", 2, ["approve"], False),
        ("threshold", 2, ["approve"], False),
    ],
)
```

Also assert that `reject` and `return_for_rerun` immediately produce a final outcome.

Run:

```powershell
python -m pytest tests/test_human_task_api.py -k "countersign" -q
```

Expected: FAIL before aggregation exists.

- [ ] **Step 6: Implement countersign aggregation**

Persist a frozen participant snapshot at task creation. Count `approve` and `modify_and_approve` decisions against the candidate artifact version. Reject duplicate reviewer decisions and version-stale decisions with `409`.

- [ ] **Step 7: Run focused assignment and countersign tests**

Run:

```powershell
python -m pytest tests/test_human_task_api.py -k "directory or claim or transfer or countersign" -q
```

Expected: PASS.

- [ ] **Step 8: Commit the vertical slice**

Run:

```powershell
git add apps/api/app apps/api/tests/test_human_task_api.py
git commit -m "feat: assign and countersign human tasks"
```

## Task 3: Resume, Rerun, Reject, and Persist Artifact Diffs

**Files:**
- Modify: `apps/api/tests/test_human_workflow_execution.py`
- Modify: `apps/api/tests/test_human_task_api.py`
- Modify: `apps/api/app/models.py`
- Modify: `apps/api/app/schemas.py`
- Modify: `apps/api/app/human_tasks.py`
- Modify: `apps/api/app/execution.py`
- Modify: `apps/api/app/main.py`

- [ ] **Step 1: Write failing tests for all four final decisions**

For a paused workflow, submit:

```python
{
    "reviewerId": reviewer_id,
    "decision": "approve",
    "reason": "内容符合要求",
    "artifactVersionId": current_version_id,
    "idempotencyKey": "decision-approve-1",
}
```

Assert approve executes only downstream nodes, modify-and-approve passes edited content to downstream, return-for-rerun creates a second source Agent `NodeRun`, and reject leaves downstream absent with run status `已驳回`.

- [ ] **Step 2: Run the decision tests and capture RED**

Run:

```powershell
python -m pytest tests/test_human_workflow_execution.py -k "approve or modify or rerun or reject" -q
```

Expected: FAIL because the resume service and four-decision contract do not exist.

- [ ] **Step 3: Implement immutable versions and text Diff**

Add `ArtifactDiffRecord`, and create versions through one method:

```python
new_version, diff = human_task_service.create_artifact_version(
    session=session,
    task=task,
    reviewer_id=request.reviewer_id,
    content=request.modified_content,
)
```

Use `difflib.unified_diff` for text and store old content, new content, and unified Diff. Reject unchanged modified content with `422`.

- [ ] **Step 4: Implement WorkflowResumeService behavior**

Refactor workflow execution into a reusable method receiving `start_node_id` and an initial `node_outputs` map. Use it for:

- continue from Human node successors;
- rerun from `source_node_id`;
- terminate without model calls;
- retry a persisted `ResumeRequestRecord`.

Set a unique key on `(human_task_id, final_decision_id)` and return the existing result for duplicate resume requests.

- [ ] **Step 5: Add decision and resume retry routes**

Implement:

```python
@app.post("/api/human-tasks/{task_id}/decisions")
@app.post("/api/human-tasks/{task_id}/retry-resume")
```

Map domain conflicts to `409` and invalid combinations to `422`.

- [ ] **Step 6: Run decision and workflow regression tests**

Run:

```powershell
python -m pytest tests/test_human_workflow_execution.py tests/test_human_task_api.py -q
```

Expected: all Human Task backend tests pass.

- [ ] **Step 7: Commit the vertical slice**

Run:

```powershell
git add apps/api/app apps/api/tests
git commit -m "feat: resume workflows from review decisions"
```

## Task 4: Add SLA Refresh, Escalation, Outbox, and Audit Timeline

**Files:**
- Modify: `apps/api/tests/test_human_task_api.py`
- Modify: `apps/api/app/models.py`
- Modify: `apps/api/app/schemas.py`
- Modify: `apps/api/app/human_tasks.py`
- Modify: `apps/api/app/main.py`

- [ ] **Step 1: Write failing SLA tests with a fixed clock**

Construct `HumanTaskService(clock=lambda: fixed_now)` and assert transitions:

```python
assert service.refresh_sla(session, task).sla_status == "即将到期"
clock.advance(minutes=31)
assert service.refresh_sla(session, task).sla_status == "已升级"
assert count_outbox(session, task.id, "escalated") == 1
assert count_audits(session, task.id, "sla_escalated") == 1
```

Call refresh twice and assert counts remain one.

- [ ] **Step 2: Run SLA tests and capture RED**

Run:

```powershell
python -m pytest tests/test_human_task_api.py -k "sla or escalation or outbox" -q
```

Expected: FAIL because SLA fields and refresh logic do not exist.

- [ ] **Step 3: Implement SLA records and idempotent refresh**

Add task fields `due_at`, `escalation_at`, `sla_status`, `escalation_group_id`, `due_reminder_sent_at`, and `escalated_at`. Add `NotificationOutboxRecord` with a unique event key and use `AuditEventRecord` for the timeline.

`refresh_sla` must:

```text
before reminder threshold -> 正常
at reminder threshold -> 即将到期 + one outbox event
after due_at -> 已逾期
after escalation_at -> transfer to escalation group + 已升级 + one outbox event
```

- [ ] **Step 4: Refresh SLA on reads and actions**

Call the same service method from task list, task detail, claim, transfer, and decision operations. Do not add a scheduler or external network call.

- [ ] **Step 5: Run SLA and complete backend suites**

Run:

```powershell
python -m pytest tests/test_human_task_api.py -q
python -m pytest -q
```

Expected: focused and complete backend suites pass.

- [ ] **Step 6: Commit the vertical slice**

Run:

```powershell
git add apps/api/app apps/api/tests/test_human_task_api.py
git commit -m "feat: track and escalate review sla"
```

## Task 5: Create Feedback Candidates and Expert-Confirmed Golden Samples

**Files:**
- Modify: `apps/api/tests/test_human_task_api.py`
- Modify: `apps/api/app/models.py`
- Modify: `apps/api/app/schemas.py`
- Modify: `apps/api/app/human_tasks.py`
- Modify: `apps/api/app/main.py`

- [ ] **Step 1: Write failing feedback tests**

Assert `approve` creates no candidate, while `modify_and_approve` creates one containing original content, modified content, Diff, reason, tags, Agent, workflow, node, and run identifiers.

Then assert:

```python
non_expert = client.post(f"/api/feedback-candidates/{candidate_id}/confirm", json=non_expert_body)
assert non_expert.status_code == 422
confirmed = client.post(f"/api/feedback-candidates/{candidate_id}/confirm", json=expert_body)
assert confirmed.status_code == 201
assert confirmed.json()["candidateId"] == candidate_id
```

- [ ] **Step 2: Run feedback tests and capture RED**

Run:

```powershell
python -m pytest tests/test_human_task_api.py -k "feedback or golden" -q
```

Expected: FAIL because feedback routes and records do not exist.

- [ ] **Step 3: Implement candidate and golden records**

Create `FeedbackCandidateRecord` at the same transaction boundary as modify-and-approve. Create `GoldenSampleRecord` only for active expert reviewers, with unique constraints on candidate and idempotency key.

- [ ] **Step 4: Add feedback query and confirmation APIs**

Implement:

```python
@app.get("/api/feedback-candidates")
@app.get("/api/feedback-candidates/{candidate_id}")
@app.post("/api/feedback-candidates/{candidate_id}/confirm", status_code=201)
```

Return an existing Golden Sample for the same idempotency key; return `409` for a conflicting second confirmation.

- [ ] **Step 5: Run focused and complete backend tests**

Run:

```powershell
python -m pytest tests/test_human_task_api.py -k "feedback or golden" -q
python -m pytest -q
```

Expected: all tests pass.

- [ ] **Step 6: Commit the vertical slice**

Run:

```powershell
git add apps/api/app apps/api/tests/test_human_task_api.py
git commit -m "feat: promote review feedback to golden samples"
```

## Task 6: Add Human Node Configuration to the Workflow Designer

**Files:**
- Modify: `src/pages/Workflows.test.tsx`
- Modify: `src/pages/Workflows.tsx`
- Modify: `src/types.ts`
- Modify: `src/index.css`

- [ ] **Step 1: Write the failing Human node configuration test**

Select a Human node and assert the editor exposes assignment type, review group, policy, threshold, due minutes, escalation minutes, and escalation group. Change values, save, and assert the workflow PATCH body contains:

```ts
expect.objectContaining({
  assignmentType: 'round_robin',
  reviewPolicy: 'threshold',
  requiredApprovals: 2,
  dueMinutes: 60,
  escalationMinutes: 120,
})
```

- [ ] **Step 2: Run the focused test and capture RED**

Run:

```powershell
npm test -- --run src/pages/Workflows.test.tsx
```

Expected: FAIL because Human-specific controls are absent.

- [ ] **Step 3: Implement Human node controls**

Reuse the existing node configuration panel and serialize values into `node.data`. Fetch reviewers and groups through `src/api/humanTasks.ts`; show loading and service errors inline.

- [ ] **Step 4: Run the focused test and capture GREEN**

Run:

```powershell
npm test -- --run src/pages/Workflows.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit the vertical slice**

Run:

```powershell
git add src/pages/Workflows.tsx src/pages/Workflows.test.tsx src/types.ts src/index.css
git commit -m "feat: configure human workflow nodes"
```

## Task 7: Build the Three-Pane Human Review Workbench

**Files:**
- Create: `src/api/humanTasks.ts`
- Modify: `src/api/execution.ts`
- Modify: `src/pages/Reviews.test.tsx`
- Modify: `src/pages/Reviews.tsx`
- Modify: `src/types.ts`
- Modify: `src/components/StatusBadge.tsx`
- Modify: `src/index.css`

- [ ] **Step 1: Write the failing queue and detail test**

Mock `/api/human-tasks`, `/api/human-tasks/{id}`, `/api/reviewers`, and `/api/review-groups`. Assert queue filters, selected artifact, quality context, SLA, countersign progress, and audit timeline render.

- [ ] **Step 2: Run the focused test and capture RED**

Run:

```powershell
npm test -- --run src/pages/Reviews.test.tsx
```

Expected: FAIL because the page still uses `/api/reviews`.

- [ ] **Step 3: Implement typed API and three-pane loading states**

Create functions:

```ts
listHumanTasks(filters)
getHumanTask(taskId)
listReviewers()
listReviewGroups()
claimHumanTask(taskId, reviewerId)
transferHumanTask(taskId, request)
decideHumanTask(taskId, request)
retryHumanTaskResume(taskId)
listFeedbackCandidates()
confirmFeedbackCandidate(candidateId, request)
```

Render queue, artifact work area, and context as sibling panels rather than nested cards.

- [ ] **Step 4: Write failing action and validation tests**

Assert:

- reason is required for all four decisions;
- modified content is required and must differ for modify-and-approve;
- claim and transfer update the selected task;
- `409` appears as an inline conflict without clearing edits;
- successful modification shows Diff and feedback candidate state.

- [ ] **Step 5: Implement actions, editor, Diff, and feedback confirmation**

Use a textarea for modification, icon buttons where symbols are familiar, and explicit text buttons for the four business commands. Disable terminal-task actions. Show approval progress and Golden Sample confirmation only when the selected reviewer is an expert.

- [ ] **Step 6: Add mobile segmented view**

At widths below the existing mobile breakpoint, render a stable segmented control with `队列`, `审核`, and `上下文`. Only the active pane is visible; preserve selection and edits while switching.

- [ ] **Step 7: Run the focused frontend tests**

Run:

```powershell
npm test -- --run src/pages/Reviews.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit the workbench**

Run:

```powershell
git add src/api src/pages/Reviews.tsx src/pages/Reviews.test.tsx src/types.ts src/components/StatusBadge.tsx src/index.css
git commit -m "feat: add human review workbench"
```

## Task 8: Update Navigation Count and Complete Frontend Regression

**Files:**
- Modify: `src/components/Layout.test.tsx`
- Modify: `src/components/Layout.tsx`
- Modify: `src/api/execution.ts`

- [ ] **Step 1: Write the failing navigation count test**

Mock `/api/human-tasks?active=true` and assert the review navigation badge counts only non-terminal tasks. Add a rejected request test that expects the shell to remain usable without a badge.

- [ ] **Step 2: Run the focused test and capture RED**

Run:

```powershell
npm test -- --run src/components/Layout.test.tsx
```

Expected: FAIL because Layout still reads the legacy review endpoint.

- [ ] **Step 3: Switch Layout to the Human Task client**

Remove legacy `listReviews` usage from the shell. Keep legacy `/api/reviews` compatibility only if existing V0.5 tests require it; the V0.6 UI must use `/api/human-tasks`.

- [ ] **Step 4: Run all frontend tests**

Run:

```powershell
npm test -- --run
```

Expected: all Vitest tests pass.

- [ ] **Step 5: Commit the navigation update**

Run:

```powershell
git add src/components/Layout.tsx src/components/Layout.test.tsx src/api/execution.ts
git commit -m "feat: show active human task count"
```

## Task 9: Documentation, Full Verification, and Browser Acceptance

**Files:**
- Modify: `.scratch/human-collaboration-feedback/issues/*.md`
- Modify: `.scratch/human-collaboration-feedback/status.md`
- Modify: `docs/CURRENT_IMPLEMENTATION.md`

- [ ] **Step 1: Run the complete backend suite**

Run:

```powershell
Set-Location apps/api
python -m pytest -q
```

Expected: all backend tests pass.

- [ ] **Step 2: Run the complete frontend suite**

Run:

```powershell
Set-Location D:\project\安克知识沉淀
npm test -- --run
```

Expected: all frontend tests pass.

- [ ] **Step 3: Run lint and production build**

Run:

```powershell
npm run lint
npm run build
```

Expected: both commands exit with code 0.

- [ ] **Step 4: Start local API and frontend servers**

Run the API on an unused local port and Vite on an unused local port without printing environment values. Confirm both health paths respond.

- [ ] **Step 5: Complete desktop browser acceptance**

At `1440x900`, verify:

1. Configure and publish a workflow with Agent, Human, and End nodes.
2. Run it and observe `等待审核`.
3. Open the review workbench and claim the task.
4. Edit the artifact and inspect Diff.
5. Submit modify-and-approve and observe downstream completion.
6. Open the feedback candidate and confirm it as an expert.
7. Verify the Golden Sample state and audit timeline.
8. Verify no console errors or incoherent overlap.

- [ ] **Step 6: Complete mobile browser acceptance**

At `390x844`, verify the segmented queue/review/context views, action controls, textarea, Diff, dialogs, and error messages fit without horizontal overflow or overlap.

- [ ] **Step 7: Exercise rejection, rerun, countersign, and SLA paths**

Use deterministic API-created test records where needed. Capture evidence that reject terminates, rerun invokes the source Agent again, all three signoff policies aggregate correctly, and repeated SLA refresh produces one escalation.

- [ ] **Step 8: Update durable and local project state**

Check every Issue acceptance criterion, append exact command results and browser evidence to `## 处理记录（Comments）`, mark `status.md` complete, and update `docs/CURRENT_IMPLEMENTATION.md` with V0.6 capabilities and explicit remaining limits.

- [ ] **Step 9: Run final diff and secret audit**

Run:

```powershell
git diff --check
git status --short
git diff -- . ':!apps/api/.env'
git ls-files | rg '(^|/)\.env$|secret|token|private'
```

Expected: no formatting errors, `.env` is not tracked, no credential value appears in the diff, and only intended V0.6 files remain.

- [ ] **Step 10: Commit V0.6**

Run:

```powershell
git add apps/api src docs/CURRENT_IMPLEMENTATION.md
git commit -m "feat: complete human collaboration feedback loop"
```

Expected: the final commit contains verified V0.6 implementation and durable documentation; `.scratch` remains local per project policy.

