---
name: code-review
description: Three-pass parallel reviewer (quality, security, dependencies) with conditional advisor adjudication. Produces review documents in thoughts/shared/reviews/. Use when changes are ready for review.
argument-hint: [scope]
---

## Scope Source

If the user has not specified what to review, ask them before proceeding. Scope is one of: `commit` (latest commit), `staged`, `working`, a commit hash or `A..B` range, or a PR branch name. Their input will appear as a follow-up paragraph after this skill body.

# Code Review

You are tasked with reviewing changes across three parallel lenses — **Quality**, **Security**, **Dependencies** — and synthesising their findings with optional stronger-model adjudication into an actionable `thoughts/shared/reviews/` artifact.

**How it works**:
- Resolve scope and assemble the diff (Step 1)
- Phase-1 Discovery Map (Step 2 — one agent + orchestrator-side git work)
- Phase-2 three-lens review + precedents + conditional CVE lookup (Step 3 — parallel agents)
- Cross-Finding Interaction Sweep (Step 4 — one synthesis agent over Phase-2 evidence, gated)
- Reconcile findings via advisor (if present) or inline dimension-sweep (Step 5)
- Grounded-questions developer checkpoint (Step 6)
- Write the review artifact (Step 7)
- Present and handle follow-ups (Steps 8–9)

## Step 1: Resolve Scope and Assemble the Diff

1. **Parse the scope argument** (follow-up paragraph or the skill's argument):
   - `commit` → `git diff HEAD~1 HEAD`
   - `staged` → `git diff --cached`
   - `working` → `git diff`
   - Commit hash `abc1234` → `git show abc1234`
   - Range `A..B` → `git diff A..B`
   - PR branch name → `git diff $(git merge-base main HEAD)..HEAD` (or the branch vs its base)

2. **Read the full diff FIRST** (orchestrator-side, before any agent dispatch):
   - `git diff --name-only [scope]` → `ChangedFiles` list
   - `git diff --stat [scope]` → size summary
   - `git diff -U0 [scope]` → hunk ranges for Phase-2 prompts (inline, don't dump to user)
   - `git log -1 --format="%s%n%n%b" [scope-ref]` → commit-message context when applicable

3. **Bail-out**: if `ChangedFiles` is empty, print `No changes in scope [scope]. Exiting.` and STOP. Do not write an artifact.

4. **Derive flags** (orchestrator-side, used in later steps):
   - `ManifestChanged` = ChangedFiles contains any path matching dependency manifests across common ecosystems:
     `package.json`, `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`,
     `pyproject.toml`, `poetry.lock`, `uv.lock`, `Pipfile`, `Pipfile.lock`, `requirements*.txt`,
     `*.csproj`, `Directory.Packages.props`, `packages.lock.json`, `global.json`,
     `go.mod`, `go.sum`,
     `Cargo.toml`, `Cargo.lock`,
     `Gemfile`, `Gemfile.lock`, `*.gemspec`,
     `pom.xml`, `build.gradle`, `build.gradle.kts`, `gradle/libs.versions.toml`,
     `composer.json`, `composer.lock`,
     `Package.swift`, `Package.resolved`, `Podfile.lock`,
     `mix.exs`, `mix.lock`, `pubspec.yaml`, `pubspec.lock`,
     `.terraform.lock.hcl`, `Dockerfile*`,
     OR a `peerDependencies`/`dependencyManagement`/central-versions block was touched.
   - `LockstepSelfReview` = repository root contains `scripts/sync-versions.js` AND every `packages/*/package.json` shares the same `version:` AND the diff touches `packages/*/package.json`.
   - `ReviewType` = one of `commit | pr | staged | working`.
   - `WorkflowRiskSignals` — run each of the five commands below. For each, set its signal to `yes` if the command produces any output, else `no`. Treat empty output as `no` — `grep`'s non-zero no-match exit is not an error. Record all five plus the `workflow_risk_gate` aggregate on the Discovery Map. The Step 4 gate reads these booleans.

     Group 1 — External I/O and persistence writes:
     ```
     git diff -U0 [scope] | grep -nE '(fetch\(|axios\.|http\.(Get|Post|Put|Delete|Patch)|requests\.(get|post|put|delete|patch)|HttpClient\b|URLSession\b|reqwest::|net/http|fs\.(readFile|writeFile)|File\.(Open|Read|Write)|Process\.Start|subprocess\.|exec\.Command|child_process|\.save\(|\.update\(|\.delete\(|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)' | head -20
     ```
     → `external_io_or_write = yes` if any match, else `no`.

     Group 2 — Retry/schedule/concurrency primitives:
     ```
     git diff -U0 [scope] | grep -nE '(\bretry\b|\bbackoff\b|\bBackOff\b|maxAttempts|\battempt(s)?\s*[<>=]=?\s*\d|\bschedule\(|\bcron\b|\bdebounce\(|\bthrottle\(|setTimeout\(|setInterval\(|\bMutex\b|\bRwLock\b|\bSemaphore\b|atomic\.|Atomic(Int|Long|Ref|Bool)\b|Interlocked\.|\bsynchronized\s*\(|\bvolatile\b)' | head -20
     ```
     → `retry_schedule_concurrency = yes` if any match, else `no`.

     Group 3 — Exported/public surface:
     ```
     git diff -U0 [scope] | grep -nE '(^[\+\-].*(export\s+(default\s+)?(function|class|const|interface|type)\s|\bpublic\s+(class|interface|struct|record|static)\s|pub\s+(fn|struct|trait|enum)\s)|@(Get|Post|Put|Delete|Patch)Mapping|app\.(get|post|put|delete|patch)\(|@app\.route|@api_view)' | head -20
     ```
     → `exported_public_surface = yes` if any match, else `no`.

     Group 4 — Schema/contract file paths:
     ```
     git diff --name-only [scope] | grep -E '(^|/)(migrations/|alembic/|db/migrate/)|\.(sql|proto|graphql[s]?|avsc)$|(^|/)(openapi|swagger).*\.ya?ml$|(^|/)prisma/schema\.prisma$'
     ```
     → `schema_contract_path = yes` if any match, else `no`.

     Group 5 — Auth-boundary (two-stage, finalized in Step 2):
     ```
     git diff -U0 [scope] | grep -nE '(middleware\b|interceptor\b|\bguard\b|@?[Aa]uthoriz|requires_auth|before_action\s+:authenticate|@PreAuthorize|@login_required|permission_classes)' | head -20
     ```
     → In Step 1, set a preliminary `auth_boundary_body` from this command's output only. In Step 2 (Discovery Map synthesis), OR that preliminary value with any auth-boundary crossings reported by the integration-scanner, and record the final `auth_boundary_body` on the Discovery Map.

     Set `workflow_risk_gate = yes` if ANY of the five group booleans is `yes`, else `no`.

     Do NOT extend these commands with: bare `dispatch(`, `emit(`, `publish(`, `enqueue(`, `produce(`, `async`, `await`, `go func`, bare `Lock`, `channel`, `select {`, or generic `export` without symbol-kind. Those patterns may appear in the Step 4 sweep prompt's prose but MUST NOT drive the gate.

## Step 2: Phase-1 Discovery Map

1. **Spawn Phase-1 agents in parallel** using the Agent tool:

   - Use **integration-scanner** to map inbound references, outbound dependencies, infrastructure wiring, and auth-boundary crossings for `ChangedFiles`.

   Agent prompt:
   > Map inbound references, outbound dependencies, and infrastructure wiring for the following changed files: [ChangedFiles, one per line]. Flag any auth-boundary crossings (middleware, guards, interceptors, authorize-style decorators) and config/DI/event registration touching these paths. Do NOT analyse code quality — connections only, in your standard output format.

2. **While the agent runs, the orchestrator produces Discovery Map facts inline** from Step 1's data:
   - `ChangedFiles`, `ManifestChanged`, `LockstepSelfReview`, `ReviewType`
   - Hunk ranges per file (from `git diff -U0`)
   - Commit-message context (if applicable)
   - Run the five `WorkflowRiskSignals` commands (Step 1) and record yes/no per group plus the `workflow_risk_gate` aggregate

3. **Wait for ALL agents to complete** before proceeding.

4. **Synthesize the Discovery Map** — a compact text block that Phase-2 agents receive verbatim as `Known Context`. Finalize `auth_boundary_body` by OR-ing the preliminary Step 1 body-match result with any auth-boundary crossings reported by the integration-scanner, then recompute `workflow_risk_gate`.

```
## Discovery Map

Review type: [ReviewType]
Scope: [scope argument]
Commit/range: [git ref]
Changed files ([N]):
  path/a.ts (+A -B)
  path/b.ts (+A -B)
Hunks:
  path/a.ts: L10-23, L45-60
  path/b.ts: L5-8
Manifest changed: [yes|no]
Lockstep self-review: [yes|no]
Workflow risk signals:
  external_io_or_write: [yes|no]
  retry_schedule_concurrency: [yes|no]
  exported_public_surface: [yes|no]
  schema_contract_path: [yes|no]
  auth_boundary_body: [yes|no]
  workflow_risk_gate: [yes|no]
Auth-boundary crossings: [from integration-scanner output, file:line]
Inbound refs: [from integration-scanner output]
Outbound deps: [from integration-scanner output]
Wiring/config: [from integration-scanner output]
```

## Step 3: Phase-2 Three-Lens Review

1. **Spawn Phase-2 agents in parallel** using the Agent tool. Each receives the `## Discovery Map` block inline as `Known Context` above its task.

**Always spawn:**

**Quality lens:**
- subagent_type: `codebase-analyzer`
- Prompt:
  ```
  Known Context:
  [paste Discovery Map verbatim]

  Task: Trace data flow through each changed hunk. For every hunk, enumerate `file:line` observations in these buckets — do NOT classify severity, the orchestrator does:
  1. Logic-bug risks: missing validation, dropped error paths, off-by-one, null/undefined misses, incorrect branch ordering, forgotten return/await, state mutations without guards.
  2. Pattern divergence: where the hunk deviates from the surrounding file's existing style/structure (cite the nearby line the hunk broke from).
  3. Blast radius: any inbound reference in the Discovery Map that the hunk's behavior change could affect (`consumer.ext:line` + what changes for it).
  4. Test coverage gaps: any risk-bearing behavior the hunk introduces that has no adjacent test reference.
  5. Cross-component consistency (1-hop only): when a hunk touches external I/O, state mutation outside local scope, retry/schedule/concurrency primitives, an exported/public symbol, a schema/contract file, or an auth boundary, compare its behavioral shape against the nearest established analogue reachable within ONE hop via the Discovery Map's inbound/outbound lists. "Behavioral shape" = what the code does, not what it is named (retry policy, I/O ordering and failure handling, input validation depth, concurrency protection, public-API signature and error channel, auth-check placement, observability symmetry, external-contract conformance). Prefer analogues already surfaced by the Discovery Map (inbound/outbound refs, wiring/config entries) or located in the same feature area (same or adjacent directory). Do NOT search broadly across the codebase. Each finding MUST cite both `hunk_file:line` AND `analogue_file:line`. If no 1-hop analogue is evident from the Discovery Map or the same feature area, omit this bucket for that hunk — do not speculate. Evidence only — no fix proposals.

  Return evidence only. No recommendations.
  ```

**Security lens:**
- subagent_type: `codebase-analyzer`
- Prompt:
  ```
  Known Context:
  [paste Discovery Map verbatim]

  Task: Grep each changed hunk for the following sink patterns and list every match with `file:line` + surrounding 3 lines. Cross-reference the Discovery Map's Auth-boundary crossings.
  For each hit, additionally return `confidence: N/10` reflecting how certain you are that a user-controlled input can reach this sink under current deployment. Do NOT report hits with confidence < 8.
  - Command execution: `exec(`, `execSync(`, `execFile(`, `child_process`, `spawn(`
  - Dynamic evaluation: `eval(`, `new Function(`
  - SQL template-interpolation: multi-line `` `SELECT ... ${ ``, `` `INSERT ... ${ ``, `` `UPDATE ... ${ ``, `` `DELETE ... ${ ``
  - XSS sinks: `innerHTML =`, `dangerouslySetInnerHTML`, `document.write(`
  - Path traversal: string concatenation into `fs.readFile`, `fs.writeFile`, `path.join` with user input
  - SSRF: `fetch(`, `http.request(`, `axios(`, `got(` where HOST or PROTOCOL (not just path) is user-controlled
  - Secrets in diff: `api_key`, `secret`, `password`, `BEGIN PRIVATE KEY`, `.env` content literal
  - Missing auth guard: auth-boundary crossings (from Discovery Map) reaching a traced sink without an upstream guard

  Hard exclusions — do NOT report:
  - DOS / resource exhaustion / rate limiting / memory or CPU exhaustion
  - Missing hardening in isolation (no traced sink), lack of audit logs
  - Theoretical race conditions / timing attacks without a concrete reproducer
  - Log spoofing, prototype pollution, tabnabbing, open redirects, XS-Leaks, regex DOS, regex injection
  - Client-side-only authn/authz gaps (server is the authority)
  - XSS in React/Angular/tsx files unless via `dangerouslySetInnerHTML`, `bypassSecurityTrustHtml`, or equivalent
  - Findings whose sole source is an environment variable, CLI flag, or UUID (trusted in our threat model)
  - Findings in test-only files or `.ipynb` notebooks without a concrete untrusted-input path
  - Outdated-dependency CVEs (handled by the dependencies/CVE lens)

  For each hit, name the pattern and quote the line. Return evidence only. No CVE lookups — that is a separate agent.
  ```

**Dependencies lens:**
- subagent_type: `codebase-analyzer`
- Prompt (only when `ManifestChanged` is true; otherwise SKIP this lens and omit the `### Dependencies` H3 block from the artifact):
  ```
  Known Context:
  [paste Discovery Map verbatim]
  Lockstep self-review: [LockstepSelfReview yes|no]

  Task: For each dependency-manifest file in the diff, infer its ecosystem primarily from the canonical manifest filename and nearby syntax in the diff (npm/yarn/pnpm, pip/poetry/uv, NuGet/MSBuild, Go modules, Cargo, Gem/Bundler, Maven/Gradle, Composer, SwiftPM/CocoaPods, Mix, Pub, Terraform lock, Docker base-image pins). If the ecosystem is ambiguous (e.g., `pyproject.toml` that could be Poetry, PEP-621, Hatch, or uv; `global.json` that may be SDK-only vs. tool-manifest; `Dockerfile` with multi-stage base-image pins), STATE the ambiguity explicitly rather than guessing — list the file with a "`ecosystem: ambiguous (<candidates>)`" marker and proceed conservatively.

  Then list:
  1. Added dependencies: `ecosystem:name@version` with `file:line`.
  2. Bumped dependencies: `ecosystem:name: old -> new` with `file:line`.
  3. Removed dependencies.
  4. Pin-strength changes (exact ↔ range, floating ↔ pinned).
  5. Peer/centrally-managed version changes (`peerDependencies`, `dependencyManagement`, `Directory.Packages.props`, Gradle version catalogs).
  6. Transitive-only drift (lockfile-only moves).
  7. Runtime/SDK/toolchain pin changes (`engines`, `global.json` SDK, `go.mod` toolchain, `rust-toolchain.toml`, `.nvmrc`, `.python-version`) — list as architectural notes.
  8. When Lockstep self-review is `yes`: flag only intra-monorepo version drift where a sibling pin diverges from the lockstep `version:` governed by `scripts/sync-versions.js`. Treat `"*"` peer pins as intentional.
  9. When Lockstep self-review is `no`: flag version-conflicts between a direct dep and its lockfile resolution.

  Return evidence only. No CVE lookups — that is a separate agent.
  ```

**Precedents lens:**
- subagent_type: `precedent-locator`
- Prompt:
  ```
  Planned change: code review of [scope]. Changed files: [ChangedFiles].
  Find the most similar past changes that touched these files or files nearby. For each precedent, report the commit hash, blast radius, any follow-up fixes within 30 days, and the one-sentence takeaway. Distil composite lessons across all precedents.
  ```

**Conditional spawn** (only when `ManifestChanged` is true):

**CVE/advisory lens:**
- subagent_type: `web-search-researcher`
- Prompt:
  ```
  For each of the following dependency changes, look up known CVEs / GitHub Advisories / OSS Index entries in the target version. If a vulnerability exists, summarize severity (Critical / High / Moderate / Low), affected version range, and whether the bumped-to version is fixed.

  Dependencies to check (format each as `ecosystem:name@version` so the advisory lookup hits the right database; common ecosystems: npm, pypi, nuget, go, crates, rubygems, maven, composer, swift, hex, pub, terraform, oci-image):
  [name@version or ecosystem:name@version, one per line — extracted by orchestrator from the diff]

  Query GHSA / OSV.dev / ecosystem-specific databases (RustSec, Trivy for images) as appropriate. Return LINKS alongside findings.
  ```

2. **Wait for ALL agents to complete** before proceeding.

## Step 4: Cross-Finding Interaction Sweep

1. **Evaluate the gate**. SKIP this step (go directly to Step 5) only when ALL of the following are true:
   - `len(ChangedFiles) < 2`, AND
   - Quality lens returned fewer than 4 total observations across all hunks, AND
   - `workflow_risk_gate` on the Discovery Map is `no`, AND
   - `precedent-locator` did not return any follow-up fix within 30 days for files in `ChangedFiles`.

2. **Spawn the interaction-sweep agent** using the Agent tool:

   - Use **codebase-analyzer** to perform a cross-finding interaction sweep over Phase-2 evidence.

   Agent prompt:
  ```
  Known Context:
  [paste Discovery Map verbatim]

  Quality Evidence:
  [paste Quality lens output verbatim]

  Security Evidence:
  [paste Security lens output verbatim]

  Precedents:
  [paste precedents output verbatim]

  Task: Perform a cross-finding interaction sweep. Group the evidence by shared entity, state machine, workflow, data flow path, API boundary, background process, or producer-consumer contract.

  For each group, check whether multiple local observations combine into an emergent defect. The sweep checks two tiers of defect classes — abstract cross-stack classes first, then the original local-composition checks:

  Abstract cross-stack defect classes (check these first):
  A1. Dual-write divergence: two sinks that must stay consistent were updated asymmetrically, or one was updated and the other was not. Covers write/read models, cache/source-of-truth, replica/primary, index/source, client-optimistic/server-authoritative, migration/ORM model.
  A2. Invariant-enforcement gap: a check enforced on one call path is bypassed on a sibling path. Covers auth scoping, tenant/account/workspace scoping, input validation, rate limiting, ACL, quota, feature flag.
  A3. Coupled-lifecycle mismatch: two artifacts that must evolve together and only one did. Covers API schema ↔ client, protobuf ↔ codegen ↔ consumer, migration ↔ model, IaC ↔ app config, event schema ↔ consumer.

  Original local-composition checks:
  L1. Contradictory assumptions between components or layers.
  L2. Unreachable, stuck, or non-terminal states.
  L3. Retry/reprocess mechanisms made inert by another behavior.
  L4. Duplicate-processing or idempotency gaps from ordering or missing guards.
  L5. Guards in one layer invalidating transitions in another.
  L6. One finding masking, amplifying, or permanently triggering another.

  Return only interaction findings backed by explicit evidence from at least two concrete file:line locations from different files or different components. No recommendations. Do not repeat single-location findings.
  ```

3. **Wait for the interaction-sweep agent to complete** before proceeding.

## Step 5: Reconcile Findings

1. **Compile evidence** from every lens and the interaction sweep (when it ran):
   - Quality evidence → classify each `file:line` observation into severity:
     - 🔴 Critical: traced flow contradiction (dropped error path, missing validation on a known sink, null-deref).
     - 🟡 Important: blast-radius × complexity-delta (hot path + new allocation, visible ABI change without migration).
     - 🔵 Suggestion: pattern divergence with a concrete nearby template.
     - 💭 Discussion: composite-lesson architecture concerns.
     - Bucket-5 (cross-component consistency) findings default to 🔵 when the divergence is structural only. Promote to 🟡 when the hunk touches I/O, an exported/public surface, a schema/contract, or an auth boundary, OR when the Discovery Map lists a concrete inbound consumer whose behavior changes. 🔴 promotion must come through the interaction sweep's defect classes, not the Quality lens alone.
   - Security evidence → classify:
     - 🔴 sink hit with a CONCRETE user-reachable source→sink path traced through Discovery Map auth-boundary crossings. Reject any hit lacking an explicit trace.
     - 🟡 crypto-only concrete issues: weak hash in an auth/integrity role (MD5/SHA1), non-constant-time compare on secrets, hardcoded key material in diff. Do NOT use 🟡 for "missing hardening".
     - 🔵 pattern divergence from a secure example in the SAME file (cite the nearby secure `file:line`).
     - 💭 architectural question.
   - Dependencies evidence → classify:
     - 🔴 Known-exploitable CVE in a touched dep (Critical/High per advisory DB) OR lockstep-contract violation (would trip `scripts/sync-versions.js`).
     - 🟡 Moderate CVE, outdated major with a migration path, license incompatibility with the project license.
     - 🔵 Minor/transitive drift.
     - 💭 Architectural dep question.
   - Interaction-sweep evidence → classify (🔴/🟡 only; no 💭 tier — the sweep must produce concrete emergent defects, not speculation):
     - 🔴 Critical: concrete emergent failure across 2+ `file:line` facts from different files/components (stranded state, duplicate-processing path, inert retry, producer/consumer contradiction).
     - 🟡 Important: concrete multi-component mismatch with bounded blast radius or an existing mitigation.
   - Precedents → compile into a separate `## Precedents & Lessons` section orthogonal to per-lens findings. Composite lessons go at the bottom of that section.

2. **Probe advisor availability** — attempt a probe by checking whether `advisor` is in the active tool set (main-thread visibility). If yes, proceed to advisor path; otherwise take the inline path.

3. **Advisor path** (when advisor is active):
   - Print a main-thread `## Pre-Adjudication Findings` block first — the advisor reads `getBranch()`, so evidence must be flushed before the call.
   - Call `advisor()` (zero-param). If it returns usable prose, paste it verbatim into `## Advisor Adjudication` and skip the inline path. Otherwise fall through.

4. **Inline path** (advisor unavailable or errored):
   - Run a dimension-sweep modeled on `skills/design/SKILL.md:83-116`: Data model / API surface / Integration / Scope / Verification / Performance.
   - For every finding, ask: does another finding contradict this severity given the Discovery Map? If yes, note the tension.
   - Produce a short `## Reconciliation Notes` block inside the artifact capturing any severity moves and the rationale.

5. **Emit the reconciled severity map** — authoritative severity per finding, carrying the advisor's guidance when present. Keep the per-pass grouping (do NOT tag each finding with its originating lens in prose; the H2 it sits under is the tag).
   - Interaction findings live in their own `### Cross-Finding Interactions` H3 under `## Issues Found`, not folded into per-lens H3s.
   - When an interaction finding subsumes multiple local findings, keep the local findings if still actionable, but lead with the interaction finding and explain the relationship in `## Reconciliation Notes`.

## Step 6: Developer Checkpoint

Use the grounded-questions-one-at-a-time pattern. Every question must reference real findings with `file:line` evidence and pull a DECISION from the developer.

**Present a compiled scan first** (under 20 lines):

```
Review: [scope]
Files: [N]
Quality: [C🔴/I🟡/S🔵/D💭]
Security: [C/I/S/D]
Dependencies: [C/I/S/D | not-applicable]
Precedents: [N composite lessons, top: "[one-line]"]
Advisor: [adjudicated | inline]
```

Wait for the developer's response. Then ask **one question at a time**, waiting for each answer.

**Question patterns:**

- **Severity dispute**: Only ask when the advisor re-ranked a finding or when inline reconciliation surfaced a contradiction. Use `ask_user_question` — Options: "Keep [original severity] (Recommended)" / "Downgrade" / "Escalate" — with `file:line` evidence in the description.
- **Scope ambiguity**: "❓ Question: finding at `file:line` lies in a test helper — does the team count test-only issues? Include in artifact or not?"
- **False-positive confirmation**: Only ask when a security/dep finding hinges on context the orchestrator cannot see (e.g., `exec()` with a variable that the developer might know is constant).

**Critical rules:**
- Ask ONE question at a time. Wait before asking the next.
- Lead with the most load-bearing finding.
- Skip the checkpoint entirely if no disputes surfaced and the developer set `status: approved` in the scan response.

## Step 7: Write the Review Document

1. **Determine metadata**:
   - Filename: `thoughts/shared/reviews/YYYY-MM-DD_HH-MM-SS_[scope-kebab].md`
   - Repository: git root basename (fallback: cwd basename).
   - Branch + commit: from git-context injected at session start, or `git branch --show-current` / `git rev-parse --short HEAD` (fallback: `no-branch` / `no-commit`).
   - Reviewer: user from injected git-context (fallback: `unknown`).

2. **Write the artifact** using the Write tool (no Edit — this skill writes once per run):

```markdown
---
date: [ISO 8601 with timezone]
reviewer: [User]
repository: [Repo name]
branch: [Branch]
commit: [Short hash]
review_type: [commit|pr|staged|working]
scope: "[What was reviewed]"
critical_issues: [Count across all lenses]
important_issues: [Count]
suggestions: [Count]
status: [approved|needs_changes|requesting_changes]
tags: [code-review, relevant-components]
last_updated: [YYYY-MM-DD]
last_updated_by: [User]
files_changed: [N]
advisor_used: [true|false]
interaction_sweep: [run|skipped-by-gate]
workflow_risk_gate: [yes|no]
---

# Code Review: [Scope Description]

**Date**: [full ISO date]
**Reviewer**: [User]
**Repository**: [Repo]
**Branch**: [Branch]
**Commit**: [Short hash]

## Review Summary
[3–5 sentences: overall verdict, highest-severity finding per lens, advisor outcome.]

## Issues Found

### Cross-Finding Interactions
(Omit this H3 block entirely when the interaction sweep was skipped per the Step 4 gate, OR when the sweep returned no findings. Only 🔴/🟡 tiers — no 💭.)
#### 🔴 Critical
- `file:line` + `file:line` (≥ 2 distinct locations) — [emergent defect narrative: which local facts combine, and how the failure path is reached]
#### 🟡 Important
- `file:line` + `file:line` — [multi-component mismatch + blast radius or existing mitigation]

### Quality
#### 🔴 Critical
- `file:line` — [evidence + one-sentence fix pointer]
#### 🟡 Important
- `file:line` — [evidence + fix pointer]
#### 🔵 Suggestions
- `file:line` — [nearby template reference + suggested alignment]
#### 💭 Discussion
- `file:line` — [open question or trade-off]

### Security
#### 🔴 Critical
- `file:line` — [sink quoted + exploitability rationale referencing auth-boundary from Discovery Map]
#### 🟡 Important
- `file:line` — [missing hardening + secure precedent]
#### 🔵 Suggestions
- `file:line` — [pattern divergence from secure example]
#### 💭 Discussion
- `file:line` — [architectural question]

### Dependencies
(Omit this H3 block entirely when the Dependencies lens was skipped — i.e., `ManifestChanged` was false.)
#### 🔴 Critical
- `dep@ver` (`package.json:line`) — [CVE id + link + affected-range + fix version]
#### 🟡 Important
- `dep@ver` — [moderate CVE / license / lockstep note with link]
#### 🔵 Suggestions
- `dep@ver` — [minor/transitive drift]
#### 💭 Discussion
- `dep@ver` — [architectural dep question]

## Precedents & Lessons
- `commit hash` — [precedent + one-sentence takeaway]
- Composite lessons (most-recurring first):
  1. [lesson 1]
  2. [lesson 2]

## Pattern Analysis
[How changes align with or diverge from existing patterns in the changed files. Cite `file:line` of the nearest established pattern.]

## Impact Assessment
[Files and inbound refs affected per the Discovery Map. Enumerate each affected consumer with `file:line` and what changes for it.]

## Historical Context
[Links to thoughts/ docs referenced by precedent-locator; one line each, no summaries.]

## Advisor Adjudication
(Omit this H2 entirely when the advisor did not run — its presence IS the signal that adjudication occurred.)
[Advisor model prose pasted VERBATIM. Do not edit or paraphrase.]

## Reconciliation Notes
(Include only when the inline path ran, OR when developer dispute in Step 5 moved a severity.)
[Short prose: which findings shifted severity and why.]

## Recommendation
[Clear verdict: Approved / Needs Changes / Requesting Changes. Cite the top 1–3 items that drove the verdict with `file:line`.]
```

## Step 8: Present and Chain

```
Review written to:
`thoughts/shared/reviews/[filename].md`

[C] critical, [I] important, [S] suggestions across [Q] quality, [Se] security, [D] dependency issues.
Advisor: [adjudicated | inline]
Status: [verdict]

Top items:
1. `file:line` — [headline]
2. `file:line` — [headline]
3. `file:line` — [headline]

Ask follow-ups, or run `/skill:revise` to address the findings.
```

## Step 9: Handle Follow-ups

- If the user asks for deeper analysis of a specific finding, spawn a targeted `codebase-analyzer` on that area (1 agent max) and append a `## Follow-up [timestamp]` section using the Edit tool.
- Update frontmatter: `last_updated`, `last_updated_by`, and `last_updated_note: "Appended follow-up on [area]"`.
- Never rewrite prior findings; only append.

## Important Notes

- **No tool-permission widening**: `allowed-tools` is intentionally omitted — the skill inherits `Agent`, `ask_user_question`, `advisor`, `Write`, `web_search`, `todo` per `.rpiv/guidance/skills/architecture.md:40`. Do NOT re-add the line.
- **Always use parallel Agent tool calls** in Phase-2 to maximise efficiency.
- **Always read the full diff FIRST** (Step 1) before spawning any Phase-1 or Phase-2 agent.
- **Always pass the Discovery Map inline** as `Known Context` to every Phase-2 agent — agents are `isolated: true` and cannot see sibling transcripts.
- **Security-lens precision stance**: prefer false negatives over false positives. Security evidence must carry `confidence ≥ 8` and 🔴 requires an explicit source→sink trace. Missing hardening without a traced sink is NOT a finding. Keep the Security-lens exclusion list in sync with the reference FP-filter precedents.
- **Critical ordering**: Follow the numbered steps exactly.
  - ALWAYS resolve scope and bail on empty diff (Step 1) before Phase-1.
  - ALWAYS wait for Phase-1 completion before Phase-2 dispatch.
  - ALWAYS wait for ALL Phase-2 agents to complete before the interaction sweep (Step 4).
  - ALWAYS run the Cross-Finding Interaction Sweep (Step 4) after ALL Phase-2 agents complete and BEFORE severity classification in Step 5, UNLESS the Step 4 gate skipped it.
  - NEVER emit an interaction finding unless it cites at least two concrete `file:line` facts from different files/components.
  - ALWAYS wait for the interaction sweep (when it ran) to complete before reconciliation (Step 5).
  - ALWAYS probe advisor availability before calling `advisor()` (strip-when-unconfigured at `packages/rpiv-advisor/advisor.ts:463-472`).
  - ALWAYS emit the `## Pre-Adjudication Findings` block to the main branch BEFORE calling `advisor()` — the advisor reads `getBranch()` (main-thread-only at `packages/rpiv-advisor/advisor.ts:336`) and will not see evidence you did not flush.
  - ALWAYS preserve the severity taxonomy emoji + naming (🔴 Critical / 🟡 Important / 🔵 Suggestions / 💭 Discussion) and the existing frontmatter keys verbatim — discovery agents `thoughts-locator` and `thoughts-analyzer` grep these.
  - NEVER call `advisor()` from inside a sub-agent — its branch is invisible to the advisor.
  - NEVER parse advisor prose mechanically — paste verbatim into `## Advisor Adjudication`.
  - NEVER add a new bundled agent to support this skill — zero-new-agents contract per `packages/rpiv-pi/extensions/rpiv-core/agents.ts:148-268` sync cost.
- **Severity classification**:
  - Evidence from agents justifies each issue's severity.
  - Every finding carries a `file:line`.
  - Correct-pattern examples cited where available.
  - Fixes are concrete (pointer, not vague).
- **Agent roles (for this skill)**:
  - `integration-scanner` (Phase-1): inbound refs, outbound deps, auth-boundary crossings.
  - `codebase-analyzer` × 3 (Phase-2): one per lens — evidence-only, no recommendations (honors the guardrail at `packages/rpiv-pi/agents/codebase-analyzer.md:113-119`).
  - `codebase-analyzer` × 1 (Step 4, gated): cross-finding interaction sweep — emergent defects only, evidence-backed across multiple locations, no recommendations.
  - `precedent-locator` (Phase-2, always): git history + thoughts/ for lessons.
  - `web-search-researcher` (Phase-2, conditional on `ManifestChanged`): CVE / GitHub Advisory / OSS Index lookups with LINKS.
- **File reading**: read the diff FULLY (no limit/offset) via `git` commands before spawning agents. Let agents read their scoped targets; the orchestrator does not need to read source files for non-risk findings.
- **Framework-agnostic defaults**:
  - The Quality-lens bucket-5, the Step 4 gate, and the interaction-sweep defect classes are phrased in universal behavioral terms (I/O, state mutation, concurrency, public surface, schema/contract, auth) rather than framework names. Do NOT add framework-specific vocabulary to these prompts. If a stack needs more specificity, open a separate RFC.
  - Bucket-5 scope cap: capped at 1 hop via Discovery Map inbound/outbound lists AND limited to same-feature-area analogues. Agents must NOT traverse beyond directly connected files or search broadly across the codebase. Preserves evidence-only discipline at `packages/rpiv-pi/agents/codebase-analyzer.md:113-119`.
  - Dependencies lens is ecosystem-neutral: the lens prompt infers ecosystem from filename and nearby syntax; ambiguous cases (e.g., `pyproject.toml`, `global.json`, `Dockerfile`) must be stated explicitly, not guessed. Adding a new ecosystem means extending `ManifestChanged` (Step 1) and optionally the ecosystem hint in the CVE lens prompt.
- **Workflow risk signals**: ALWAYS run the five `WorkflowRiskSignals` commands (Step 1) and record their yes/no results on the Discovery Map. NEVER approximate the patterns by eye — the Step 4 gate reads the recorded booleans.
- CC auto-loads CLAUDE.md files when agents read files in a directory — no need to scan for them explicitly.
