# Zeabur-Only Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove inactive Cloudflare Pages and Render deployment paths, then deploy the exact CI-verified `master` commit to the existing Zeabur service with automatic and manual triggers.

**Architecture:** Keep the existing root Dockerfile as the single same-origin production artifact and retain `apps/api/Dockerfile` for Compose/worker use. A Zeabur GitHub Actions workflow consumes successful `master` CI runs, uploads an exact checkout through the official CLI, and waits until a public commit marker proves that the new revision is serving before running live checks.

**Tech Stack:** GitHub Actions, Zeabur CLI, Docker, Nginx, React/Vite, FastAPI, Node.js deployment verification.

## Global Constraints

- Production hosting is GitHub + Zeabur + Zeabur PostgreSQL only.
- `ZEABUR_TOKEN` must only be read from a GitHub Secret.
- Zeabur project, service, environment, production URL, and auto-deploy switch must be GitHub Variables.
- Automatic deployment only follows a successful `push` CI for the current `origin/master` SHA.
- Manual deployment must verify an exact successful `master` push CI result for its target SHA.
- Public verification must match the target SHA before accepting homepage and API health.
- The deployment workflow must pin Zeabur CLI `0.19.0`; do not consume `latest` in production.
- Do not change database schema, application APIs, or Zeabur runtime secrets.

---

### Task 1: Turn deployment verification into the Zeabur-only contract

**Files:**
- Modify: `scripts/verify-deployment.mjs`

**Interfaces:**
- Consumes: repository files from `process.cwd()`.
- Produces: exit code `0` only when the Zeabur-only deployment contract is present and legacy platform files are absent.

- [ ] **Step 1: Replace required legacy files with the Zeabur workflow and define forbidden files**

Add `.github/workflows/deploy-zeabur.yml` and `.github/workflows/ci.yml` to required files. Add a `forbiddenFiles` list containing:

```js
const forbiddenFiles = [
  '.github/workflows/deploy-pages.yml',
  'public/_headers',
  'public/_redirects',
  'render.yaml',
  'scripts/write-cloudflare-headers.mjs',
  'scripts/write-cloudflare-headers.test.mjs',
  'wrangler.toml',
]
```

Fail with `Legacy deployment file must be removed: <path>` when any remains.

- [ ] **Step 2: Replace Cloudflare/Render checks with Zeabur-only checks**

The workflow check must require:

```text
name: Deploy Zeabur
workflow_run:
workflows: [CI]
workflow_dispatch:
vars.ZEABUR_AUTO_DEPLOY == 'true'
secrets.ZEABUR_TOKEN
vars.ZEABUR_PROJECT_ID
vars.ZEABUR_SERVICE_ID
vars.ZEABUR_ENVIRONMENT_ID
vars.ZEABUR_PRODUCTION_URL
npx zeabur@latest auth login
npx zeabur@latest deploy
public/deployment.json
deployment.json?sha=
npm run deploy:check:live
```

The root Dockerfile check must require `RUN VITE_API_BASE_URL= npm run build` and reject `build:pages`.
Documentation checks must require Zeabur-only topology, CI-gated deployment, the GitHub Secret/Variables, and exact-SHA live acceptance.

- [ ] **Step 3: Run the verifier and confirm RED**

Run:

```powershell
node scripts/verify-deployment.mjs
```

Expected: non-zero exit with missing `deploy-zeabur.yml` and legacy file failures. The failure must be caused by the intended deployment contract, not JavaScript syntax errors.

---

### Task 2: Remove inactive platform artifacts and switch the production build

**Files:**
- Delete: `.github/workflows/deploy-pages.yml`
- Delete: `public/_headers`
- Delete: `public/_redirects`
- Delete: `render.yaml`
- Delete: `scripts/write-cloudflare-headers.mjs`
- Delete: `scripts/write-cloudflare-headers.test.mjs`
- Delete: `wrangler.toml`
- Modify: `package.json`
- Modify: `Dockerfile`
- Modify: `.env.example`
- Modify: `apps/api/.env.example`
- Modify: `apps/api/tests/test_network_security.py`

**Interfaces:**
- Consumes: standard Vite build output at `dist`.
- Produces: the same root Docker image without Cloudflare-specific artifacts; network tests use a neutral Zeabur origin.

- [ ] **Step 1: Remove legacy files with one reviewable patch**

Delete only the seven files listed above. Do not remove `apps/api/Dockerfile`, `compose.yaml`, `nginx.conf.template`, `.github/workflows/ci.yml`, or Dependabot.

- [ ] **Step 2: Remove the Pages build command**

Remove `build:pages` from `package.json` and add the deployment commands already used by CI and
the release workflow:

```json
"deploy:check": "node scripts/verify-deployment.mjs",
"deploy:check:live": "node scripts/check-live-deployment.mjs"
```

Change the root Dockerfile line to:

```dockerfile
RUN VITE_API_BASE_URL= npm run build
```

- [ ] **Step 3: Make environment examples same-origin**

Set root `.env.example` to an empty `VITE_API_BASE_URL=` with a comment that production uses same-origin `/api`. Replace the Pages host example in `apps/api/.env.example` with the Zeabur application host placeholder.

- [ ] **Step 4: Make network-security fixtures platform-neutral**

Replace `https://arc-one.pages.dev` with `https://arc-one.example.com` in the test settings, request origins, and expected response header. Do not change the tested CORS behavior.

- [ ] **Step 5: Run focused build and security tests**

Run:

```powershell
npm run build
& 'D:\project\安克知识沉淀\apps\api\.venv\Scripts\python.exe' -m pytest apps/api/tests/test_deploy_compose.py apps/api/tests/test_network_security.py -q
```

Expected: build succeeds; all focused backend tests pass. The deployment verifier remains RED because workflow and documentation are not complete yet.

---

### Task 3: Add the CI-gated Zeabur production workflow

**Files:**
- Create: `.github/workflows/deploy-zeabur.yml`

**Interfaces:**
- Consumes: successful `CI` workflow run or manual `commit_sha`, `ZEABUR_TOKEN`, and Zeabur resource variables.
- Produces: a deployment of the exact checkout and a verified public `deployment.json` commit marker.

- [ ] **Step 1: Define safe triggers and concurrency**

Use `workflow_run` for completed `CI` workflows and `workflow_dispatch` with optional `commit_sha`. Set:

```yaml
concurrency:
  group: zeabur-production
  cancel-in-progress: false
```

The job condition must allow manual runs, or successful `master` push CI runs when
`ZEABUR_AUTO_DEPLOY == 'true'`.

- [ ] **Step 2: Resolve and validate the target commit**

Checkout current `master` delivery controls into `.delivery`, then checkout the workflow-run SHA,
manual input, or `master` into `source`. Resolve `git rev-parse HEAD`, fetch `origin/master`, and
require:

```bash
git merge-base --is-ancestor "$DEPLOY_SHA" origin/master
```

For automatic runs, also require the target SHA to equal current `origin/master`. For manual runs,
query `actions/workflows/ci.yml/runs?head_sha=<sha>&status=completed` using the runner's `GH_TOKEN`
and require an exact successful `push` run whose `head_branch` is `master`.

- [ ] **Step 3: Validate GitHub configuration without echoing secrets**

Require non-empty project ID, service ID, environment ID, and production URL before uploading.
Require `ZEABUR_TOKEN` only inside the deploy step. Only print missing setting names; never print values.

- [ ] **Step 4: Create provenance marker and deploy**

Write this untracked file in the runner:

```json
{"commit":"<full SHA>"}
```

Set `ZEABUR_CLI_VERSION=0.19.0`. Authenticate non-interactively with the pinned CLI and
`--token "$ZEABUR_TOKEN"`, invoke `deploy -i=false`, then run `auth logout` from an EXIT trap.
Reject production URLs that contain credentials, a non-root path, query, fragment, or a protocol
other than HTTPS.

- [ ] **Step 5: Wait for the exact revision and run live checks**

Poll `${ZEABUR_PRODUCTION_URL}/deployment.json?sha=${DEPLOY_SHA}` for up to 15 minutes. Continue only when parsed JSON has `commit === DEPLOY_SHA`; an old healthy revision must not pass. Then run:

```bash
FRONTEND_URL="$ZEABUR_PRODUCTION_URL" \
API_URL="$ZEABUR_PRODUCTION_URL" \
npm run deploy:check:live
```

For rollback commits created before the npm alias existed, call
`node scripts/check-live-deployment.mjs` as a compatibility fallback.

- [ ] **Step 6: Run the static verifier**

Run `node scripts/verify-deployment.mjs`.

Expected: still RED only for documentation/legacy references that Task 4 will remove; no workflow-pattern failures.

---

### Task 4: Make Zeabur the single documented production path

**Files:**
- Modify: `SECURITY.md`
- Modify: `docs/DEPLOYMENT.md`
- Modify: `docs/DEPLOYMENT_VALUES.template.md`
- Modify: `docs/ZEABUR_DEPLOYMENT.md`
- Modify: `docs/SECURITY.md`
- Modify: `docs/CURRENT_IMPLEMENTATION.md`

**Interfaces:**
- Consumes: the Zeabur workflow contract and root same-origin Dockerfile.
- Produces: one non-contradictory operator path from development through public acceptance.

- [ ] **Step 1: Rewrite the deployment entrypoint**

`docs/DEPLOYMENT.md` must state the canonical sequence:

```text
worktree -> PR -> CI -> merge master -> master CI -> Zeabur deploy -> public acceptance
```

Explain automatic and manual triggers, exact-SHA marker, rollback by redeploying a previous successful commit, and the prototype limitation.

- [ ] **Step 2: Rewrite the private values template**

Document the one Secret and five Variables without real values. Include the production URL and live-check command. Remove all Cloudflare and Render sections.

- [ ] **Step 3: Replace obsolete split Zeabur instructions**

Describe the current same-origin root Dockerfile, one application service plus Zeabur PostgreSQL, runtime environment categories, GitHub setup, and manual fallback. Do not preserve hard-coded resource IDs in committed documentation.

- [ ] **Step 4: Align security and current-state documentation**

Replace Pages-specific security claims with Nginx/FastAPI same-origin controls and CI-gated provenance. Record that Cloudflare Pages and Render support were intentionally removed, while the application remains a prototype rather than a high-availability production platform.

- [ ] **Step 5: Run repository-wide legacy scan and verifier**

Run:

```powershell
rg -n --hidden --glob '!node_modules/**' --glob '!.git/**' --glob '!.worktrees/**' -i "cloudflare pages|render\.yaml|wrangler|pages\.dev|build:pages|deploy-pages"
node scripts/verify-deployment.mjs
```

Expected: the scan only finds historical rationale in the approved design/plan; verifier passes.

---

### Task 5: Verify and commit the implementation

**Files:**
- Modify: `.scratch/zeabur-only-deployment/status.md`
- Modify: `.scratch/zeabur-only-deployment/issues/01-remove-legacy-deployments.md`
- Modify: `.scratch/zeabur-only-deployment/issues/02-automate-zeabur-delivery.md`

**Interfaces:**
- Consumes: all implementation changes.
- Produces: fresh verification evidence and a clean feature branch.

- [ ] **Step 1: Run frontend quality gates**

```powershell
npm test -- --run
npm run lint
npm run build
node scripts/verify-deployment.mjs
```

Expected: all exit `0`.

- [ ] **Step 2: Run complete backend tests**

```powershell
& 'D:\project\安克知识沉淀\apps\api\.venv\Scripts\python.exe' -m pytest apps/api/tests -q
```

Expected: all tests pass; only known third-party deprecation warnings are acceptable.

- [ ] **Step 3: Run adversarial static checks**

```powershell
git diff --check
git status --short
rg -n --hidden --glob '!node_modules/**' --glob '!.git/**' --glob '!.worktrees/**' "ZEABUR_TOKEN|CLOUDFLARE_API_TOKEN|MODEL_API_KEY="
```

Verify no secret value is committed, no legacy deployment file remains, and the workflow cannot accept a failed/non-master commit.

- [ ] **Step 4: Update local issue status**

Mark both issue acceptance lists complete and set them to `ready-for-human`. Record test evidence in `status.md`; these files remain ignored and are not committed.

- [ ] **Step 5: Commit the implementation**

```powershell
git add --all
git commit -m "Consolidate production delivery on Zeabur"
```

---

### Task 6: Push, review, merge, deploy, and verify production

**Files:** None.

**Interfaces:**
- Consumes: clean `codex/zeabur-only-deployment` branch.
- Produces: merged GitHub `master`, a Zeabur deployment of that exact SHA, and public acceptance evidence.

- [ ] **Step 1: Push the feature branch**

```powershell
git push -u origin codex/zeabur-only-deployment
```

- [ ] **Step 2: Open a pull request and wait for CI**

Create a PR into `master`. Do not merge until the `CI` workflow succeeds for the PR head.

- [ ] **Step 3: Merge without bypassing CI**

Merge the PR, update local `master`, and record the resulting full SHA.

- [ ] **Step 4: Configure GitHub deployment settings**

In repository settings, store `ZEABUR_TOKEN` as a Secret and the five `ZEABUR_*` non-secret values as Variables. Set `ZEABUR_AUTO_DEPLOY=true` only after the first manual workflow succeeds.

- [ ] **Step 5: Run the first controlled deployment**

Trigger `Deploy Zeabur` manually for the merged SHA. Confirm the action validates CI, deploys, matches the public commit marker, and passes live checks. Then enable automatic deployment.

- [ ] **Step 6: Perform browser acceptance**

Open the production URL, verify login and the main workspace page, inspect console errors, and retain a screenshot. Confirm the public marker equals the merged SHA.

- [ ] **Step 7: Clean up the worktree**

Only after merge and production acceptance, remove the feature worktree and delete the local feature branch if it is no longer needed.
