# AI Assistant Production Environment Closure Plan

> Status: planning only. This document does not redesign Assistant UI, introduce AssistantV3, change provider billing, or trigger paid model calls.

## 0. Goal

The current Assistant already has the product foundation needed for production work: page/project context, action-first cards, verified progress, approval boundaries, existing capability routing, generation execution, Candidate → Compare → explicit Adopt/Keep, and animation repair integration.

The next step is not another Assistant generation. The next step is to close the production environment around the existing Assistant so that a team can trust it every day.

Target end state:

> User intent → resolved context → capability eligibility → provider/runtime health → authoritative server plan → cost/approval disclosure → execution → verified receipt → durable resume → observable failure/recovery.

The Assistant must remain a projection/control surface over existing truths. It must not become a second workflow engine, second project truth, second provider registry, or second billing system.

## 1. Scope

This closure covers the environment surrounding the existing Assistant runtime:

- provider/runtime readiness and live certification status
- capability registry and provider compatibility truth
- execution preflight and fail-closed behavior
- approval, points, idempotency and rights revalidation
- durable resume / recovery after refresh or process interruption
- provider failure classification and retry policy
- observable execution receipts and user-facing recovery guidance
- production health/telemetry for Assistant actions
- stale/open-PR reconciliation that can confuse coding agents or deployment baselines
- default-branch / deployment-baseline clarity

This closure explicitly does **not** include:

- AssistantV3 / RouterV3 / ProductionBoardV2
- redesigning phone or desktop Assistant UI
- exposing model chain-of-thought
- new hidden paid cascades
- auto-Adopt / auto-Promote
- silently switching provider/model to make an action appear successful
- adding a second project, Canon, storyboard, generation, cost, approval or completion truth
- making general browser/computer-use claims beyond currently landed runtime capabilities

## 2. Current baseline

The implementation must start from the current repository default branch and first reconcile what is already landed.

Known landed foundations include:

- Phone AI-first shell and <768px / >=768px product split
- Phone Assistant Action-First v2
- Assistant context/projection cards and verified work events
- Animation Temporal & Visual Consistency Engine
- Production Board / Review Queue / targeted repair
- Phone AI × Production Board repair loop
- explicit Candidate → Compare → Adopt/Keep boundaries
- server-authoritative repair planning and cost confirmation
- provider-aware generation command path, points, approvals and idempotency
- commercial-rights / execution-rights revalidation foundations

Before implementation begins, produce a CURRENT HEAD evidence table that maps each of the above to exact source files/tests and identifies any stale planning PR whose scope has already been superseded.

## 3. Production invariants

These are hard rules for every implementation PR.

1. **Single Assistant runtime.** No AssistantV3 fork.
2. **Single capability truth.** Assistant UI may project capability state but must not maintain an independent provider/model matrix.
3. **Fail closed.** Unknown provider health, missing certification, expired rights, ambiguous target, missing cost estimate, or stale execution context must never be represented as success.
4. **No silent paid work.** Any paid stage/model must be disclosed before execution and use existing approval/points policy.
5. **No silent provider/model switch.** A fallback may be proposed, but changing the model/provider requires an explicit policy path and must be visible in the execution plan/receipt.
6. **No fake progress.** UI may show verified stages/events only, not invented percentages or hidden reasoning.
7. **Explicit human state changes.** Adopt/Keep/Promote/destructive operations remain explicit.
8. **Durable receipts.** A successful Assistant action must be explainable after refresh using persisted server truth, not client-only state.
9. **Idempotent retries.** Retrying the same authorized action must not duplicate charge or create conflicting side effects.
10. **Current rights at execution time.** Rights/ACL/membership/provider eligibility must be revalidated at the last safe point before charge/provider call.
11. **No global health = false green.** A healthy web app does not imply every provider or Assistant capability is healthy.
12. **Desktop/mobile share execution truth.** Different surfaces may project different UX, but the action lifecycle and receipts are shared.

## 4. Workstream A — Environment & Provider Readiness

### A1. Unified provider readiness projection

Build a server-authoritative readiness projection from existing provider configuration/certification/health data. It should answer, per capability/provider/model where evidence exists:

- configured / not configured
- certification state: certified / blocked_external / failed / not_checked / stale
- last successful certification time
- capability compatibility relevant to the requested action
- whether a paid live check is required before claiming readiness
- whether the failure is operator-fixable (missing key, billing/quota, disabled model, network, policy)

Do not invent a new provider registry if existing registries/configuration already carry the data. Reconcile and extend the existing truth instead.

### A2. Certification freshness

Define freshness/version invalidation rules. Certification must become stale when relevant configuration changes, for example:

- API key/config identity changes
- provider model mapping changes
- capability declaration changes
- critical adapter version changes

A stale certification is not equivalent to failure and not equivalent to ready.

### A3. Readiness API contract

Expose a compact Assistant/runtime readiness projection that is safe to use from mobile/desktop without triggering live paid provider calls on page load.

No new polling loop. Reuse existing app health/session fetch patterns where possible and keep provider-live certification explicitly on-demand or operator-triggered.

## 5. Workstream B — Capability Registry Closure

### B1. One compatibility source

Audit Assistant capabilities, generation model routing, provider adapters, animation stages and phone capability guides. Remove duplicated compatibility declarations where they can drift.

The resulting flow should be:

`User intent → Assistant capability → execution action/stage → required model capabilities → eligible configured providers/models`.

### B2. Capability downgrade contract

When the requested capability cannot be fully met, return a structured downgrade, for example:

- multi-reference unsupported
- multi-character identity unsupported
- image-to-video source unavailable
- visual evaluator unavailable
- provider certification stale

Every downgrade must include:

- what cannot be guaranteed
- what still can be done
- whether the user must approve a different model/stage
- whether the result will remain unverified / not_checked

Never transform a downgrade into success wording.

### B3. Assistant planning integration

The Assistant should consume this structured capability truth before proposing execution. The proposal card should never promise a capability that the chosen execution path cannot provide.

## 6. Workstream C — Execution Preflight & Verified Receipts

### C1. Server-authoritative preflight

Before paid or state-changing execution, server preflight must verify:

- project/team membership and ACL
- target object still exists and is not stale/deleted
- execution/commercial rights
- provider/model eligibility and readiness state
- cost estimate and approval requirement
- quota/points availability
- idempotency key / duplicate request status
- required input/reference assets still exist and are usable
- no conflicting current-state change invalidates the proposal

The preflight result must be the exact source for the confirmation UI. Client logic must not reconstruct cost or affected targets independently.

### C2. Execution receipt

Every Assistant-triggered execution should end in a durable, inspectable receipt containing only externally useful facts, such as:

- requested action/capability
- resolved targets
- actual model/provider/stage used
- approval decision reference when applicable
- actual charge/refund outcome
- output asset/generation IDs
- candidate/current effect
- verification/evaluation result
- structured warnings/downgrades
- terminal status: success / partial_success / blocked / failed / cancelled

Do not persist or expose chain-of-thought.

### C3. Partial success

Partial success must preserve successful Candidate outputs and identify failed/blocked siblings. Retry must be target-aware and reuse existing successful work instead of blindly rerunning the whole batch.

## 7. Workstream D — Durable Resume & Recovery

### D1. Resume projection

After hard refresh, process restart, or Assistant surface remount, reconstruct useful state from existing persisted truths:

- awaiting approval
- queued/submitted/running where authoritatively known
- partial success
- review ready
- compare/adopt pending
- failed/blocked with recovery action

Do not create a second Assistant workflow table unless the existing durable action/generation/goal truths demonstrably cannot represent the state. Any proposed schema addition must first prove why existing persisted sources are insufficient.

### D2. Recovery actions

Map structured failure classes to safe next actions:

- missing/invalid configuration → operator setup action
- billing/quota external block → no automatic retry storm
- transient provider/network issue → bounded retry using existing idempotency
- stale proposal/context → re-plan instead of replay
- rights revoked → stop, no charge/provider call
- evaluation unavailable → preserve output, mark not_checked, offer later verification
- partial generation failure → retry failed targets only

### D3. No polling explosion

Resume and health UX must not add per-card or per-shot polling. Prefer event-driven invalidation and bounded project-level projections already used by the app.

## 8. Workstream E — Observability & Production Operations

### E1. Assistant action telemetry

Add operational metrics/logging around the existing action lifecycle without logging private prompt content unnecessarily:

- capability selected
- preflight pass/block reason
- approval requested/approved/rejected
- provider submit success/failure class
- terminal action status
- duration by verified stage
- idempotent replay count
- refund/reversal event
- stale-context replan count

### E2. Health separation

Separate at least these concepts:

- web/app health
- database/storage health
- Assistant runtime health
- provider configuration health
- provider live certification health
- capability availability

A green `/api/ready` or deployment must not imply every paid AI capability is live-certified.

### E3. Operator diagnostics

Provide a compact operator-only diagnostic view or endpoint using existing admin/settings patterns. It should answer “why can’t this capability run?” without requiring log-diving.

Do not expose API keys, raw secrets or private user content.

## 9. Workstream F — Repository / Deployment Baseline Closure

### F1. Default branch clarity

The repository currently uses a non-standard long-lived default branch name. Do not rename it inside the first runtime PR. First document:

- current default branch and deployment source
- CI branch assumptions
- preview vs production deployment source
- any automation hard-coded to the branch name

Then create a separate migration plan if moving to `main` is desirable. The product closure must not be blocked by a cosmetic branch rename.

### F2. Open PR reconciliation

Create a machine-readable/reviewer-readable table for stale open PRs that touch Assistant/provider/agent/runtime areas:

- still required
- superseded by merged work
- conflicts with current architecture
- docs-only historical context
- should close without merge

Do not merge old stacked branches simply because they are open.

### F3. Agent baseline guard

Update agent/developer guidance so coding agents always resolve CURRENT default HEAD before trusting an old PR plan. Planning docs should state their base SHA/date and supersession status.

## 10. Implementation stack

Implement as four bounded Draft PRs from the latest default. Rebase/reconcile before each PR; do not stack indefinitely on stale branches.

### PR-A — Provider Readiness + Capability Truth

Deliverables:

- CURRENT provider/capability inventory
- unified readiness projection
- certification freshness/stale semantics
- structured capability downgrade contract
- Assistant planning reads the same capability truth
- unit tests + configuration fixtures

No paid live call in CI.

### PR-B — Execution Preflight + Durable Receipts

Deliverables:

- authoritative preflight contract
- last-safe-point rights/readiness/cost/idempotency verification
- confirmation UI driven by server proposal/preflight
- durable execution receipt projection
- partial-success semantics
- real PostgreSQL tests for charge/idempotency/current-state races

No silent fallback/model switch.

### PR-C — Resume + Failure Recovery

Deliverables:

- hard-refresh resume projection
- structured failure taxonomy and recovery mapping
- target-aware retry
- stale-proposal → replan behavior
- external billing/quota block suppression to prevent retry storms
- mobile/desktop shared lifecycle tests

No per-card polling.

### PR-D — Production Certification + Ops Acceptance

Deliverables:

- operator diagnostics
- separated health/readiness surfaces
- end-to-end production-environment acceptance suite
- stale-open-PR reconciliation document
- deployment/default-branch dependency inventory
- phone 360/390/430 and desktop 768/820/1024/1280/1440 regression
- final payload/API/query budgets

Live provider checks, if run, must be explicit, bounded and never required for normal CI.

## 11. Acceptance scenarios

The closure is not complete until these scenarios are machine-verifiable where practical.

1. **Healthy configured provider**: Assistant proposes a capability only when the selected execution path supports it.
2. **Missing provider key/config**: preflight blocks before charge and returns operator-fixable reason.
3. **Certification stale**: system says stale/not checked, not healthy and not failed.
4. **External billing/quota block**: no automatic retry storm; action remains recoverable.
5. **Rights revoked after proposal**: execution revalidation blocks before charge/provider call.
6. **Target changed after proposal**: stale proposal is rejected and Assistant replans.
7. **Duplicate submission**: same idempotency intent does not duplicate charge or side effect.
8. **Partial success**: successful Candidates remain; retry covers failed targets only.
9. **Evaluator unavailable**: generation may exist but verification is explicitly `not_checked`.
10. **Hard refresh during approval**: user returns to awaiting approval using persisted truth.
11. **Hard refresh after generation**: user returns to review/compare state without replaying generation.
12. **Explicit Adopt/Keep**: only explicit human decision changes current/review state.
13. **Provider/model downgrade**: displayed before execution; no silent model switch.
14. **Mobile/desktop parity**: surfaces differ but receipt/status/targets/cost remain identical.
15. **No hidden extra API fanout**: Assistant cards/readiness projection stay within declared API/query budgets.

## 12. Test matrix

Minimum gates for implementation PRs:

- TypeScript typecheck
- server + client unit/integration suites
- migration safety if schema changes (prefer no schema addition unless justified)
- real PostgreSQL integration for cost/idempotency/rights/concurrency paths
- E2E mock-provider action flows
- mutation/negative tests proving safeguards actually fail when removed
- accessibility for confirmation/error/recovery states
- phone and desktop leakage/regression tests
- query-count/bundle/request budgets
- secret-redaction tests for diagnostics/telemetry

Production/provider tests must distinguish:

- deterministic fixture/parser tests
- configured-provider integration tests
- paid live certification tests

A fixture must never be reported as live provider certification.

## 13. Security / privacy

- no secrets in client projections, traces, receipts or screenshots
- redact provider credentials and sensitive headers
- minimize prompt/content logging; use IDs/categories where operationally sufficient
- preserve team/project ACL on diagnostics and receipts
- no cross-tenant idempotency replay or receipt lookup
- provider error text must be normalized before user display/log persistence where it may contain sensitive request details

## 14. Definition of Done

This plan is complete when:

- the existing Assistant can determine whether a requested action is actually runnable before promising it
- paid/state-changing work has server-authoritative preflight and confirmation
- every Assistant-triggered action has a durable verified terminal receipt
- refresh/restart can reconstruct approval/execution/review state without client-only truth
- provider unavailable/stale/billing/quota/rights/context failures are distinct and recoverable
- no silent provider/model switch, no hidden paid cascade, no silent Adopt
- operator can diagnose capability unavailability without reading raw logs
- CI does not require paid provider calls
- mobile performance improvements from the Phone AI-first work are preserved
- stale open PRs and deployment/default-branch assumptions no longer confuse CURRENT architecture decisions

## 15. Start instruction for coding agents

Before writing runtime code:

1. fetch the latest default branch and record the base SHA;
2. inventory existing provider certification, capability registry, generation command, approval/points/idempotency, Assistant runtime and health endpoints;
3. map each requested change to an existing source of truth;
4. explicitly list any duplicate system you are **not** creating;
5. run baseline tests and record pre-existing failures separately;
6. implement only PR-A scope first;
7. open as Draft, no auto-merge, no force-push, no paid provider call.

If an existing merged capability already satisfies a requirement, reuse it and add evidence/tests instead of rebuilding it.
