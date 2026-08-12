# Aios Agent v5 — Live Certification, Deep Defect Discovery, and Reliability Hardening

## Purpose

This is the implementation/verification contract after merged PR #645 (Practical Autonomy v4) and Issue #646.

The goal is **not** to add a giant speculative feature set. The goal is to prove that every Agent capability that Aios claims to have is actually usable end to end in a production-like environment, under real backend/database/provider conditions, with correct authorization, idempotency, verification, recovery, and mobile UX.

Primary loop:

`USE → OBSERVE → BREAK → DIAGNOSE → FIX ROOT CAUSE → RETEST → REGRESSION → FRESH-EYE → SOAK/CHAOS → REPEAT`

System path under test:

`USER GOAL → UNDERSTAND → RESOLVE CONTEXT → LIVE CAPABILITY HEALTH → PLAN → POLICY KERNEL → IDEMPOTENT EXECUTION → REAL BACKEND / DB / PROVIDER → EXECUTION RECEIPT → READ-BACK VERIFICATION → RECOVER / REPLAN → CERTIFIED RESULT → USER`

## Existing evidence baseline

Treat the uploaded Complete Defect Report / Codex Remediation Playbook as an evidence baseline, not as the whole defect universe. It already established real live problems such as deployment SHA drift, Browser/Computer Runtime capability mismatch, NIM timeout degradation, SSE/tRPC races, run lifecycle inconsistencies, and SPA memory growth.

Do not re-label speculative risks below as already-proven production defects. Every new candidate must be marked as one of:

- `PROVEN_BY_CURRENT_CODE`
- `PROVEN_BY_LIVE_REPRO`
- `LIKELY_ARCHITECTURAL_RISK`
- `NEEDS_STAGING_VERIFICATION`
- `BLOCKED_BY_EXTERNAL_DEPENDENCY`

## Capability certification model

A capability is not considered usable merely because it exists in a registry or compiles.

Every capability must pass six proof layers:

1. **Declared** — registered in the single server-owned capability/tool registry.
2. **Resolvable** — natural user wording resolves to the correct capability, project/source/entity/referents.
3. **Reachable** — handler/router/service exists and is deploy-reachable with correct middleware.
4. **Executable** — real backend/provider operation runs successfully.
5. **Verifiable** — authoritative read-back/evidence confirms the intended effect.
6. **Useful** — result is clear and actionable in the real UI, especially mobile.

Allowed certification states:

- `DECLARED_ONLY`
- `MOCK_VERIFIED`
- `STAGING_VERIFIED`
- `EXTERNAL_LIVE_VERIFIED`
- `PRODUCTION_SMOKE_VERIFIED`
- `CERTIFIED`
- `DEGRADED`
- `BLOCKED_BY_EXTERNAL_DEPENDENCY`
- `BROKEN`

The Agent planner must use live capability status, not a static wish list.

## Required Live Capability Verification Matrix

For every registered capability/tool, record at minimum:

- capability id
- label/domain
- execution mode
- handler
- registry declared
- handler resolved
- router/service reachable
- middleware/auth enforced
- required context slots resolvable
- real DB/storage/provider reached
- write effect persisted
- read-back verifier passed
- retry/idempotency tested
- confirmation/risk policy tested
- mobile flow usable
- last live verification timestamp
- current certification state
- blocker/evidence link

Internal CRUD/search tools must be tested against a dedicated staging DB/storage with authoritative independent read-back.
External tools must use dedicated QA credentials/accounts where available.
Mock-only success may never be labeled live-verified.

## Deep defect candidates — FIX-15 onward

### FIX-15 — Capability Registry ↔ Runtime Drift

**Severity:** P0
**Status:** NEEDS_STAGING_VERIFICATION / architectural risk reinforced by historical Browser 404 evidence.

Risk: registry handler strings can exist while the actual production router/service is missing, stale, disabled, or middleware-incompatible.

Required fix direction:
- build a capability contract test that resolves every handler at build/CI time;
- validate router registration, middleware, provider availability, and verification handler;
- expose dangling/unavailable capability counts;
- fail production readiness if any required capability has a dangling handler.

Acceptance:
- `0 dangling handlers` for required capabilities;
- deployment status exposes registry hash + availability summary.

### FIX-16 — `job_registered` falsely treated as completion

**Severity:** P0
**Status:** PROVEN_BY_CURRENT_CODE candidate where verificationStrategy=`job_registered` exists.

A queued job is not a completed user effect.

Required lifecycle:
`ACCEPTED → QUEUED → RUNNING → PERSISTED → INDEXED → VERIFIED → COMPLETED`

For intake/classification/generation-like work, Agent completion must wait for the stage required by the user goal, not merely job insertion.

Acceptance:
- no user-facing `completed` from queue insertion alone;
- failure after queueing surfaces exact non-completed state;
- downstream steps cannot consume an unpersisted/unverified result as completed.

### FIX-17 — Missing explicit Idempotency Contract per tool

**Severity:** P0

Every write/external capability must define:
- idempotency policy
- idempotency-key strategy
- retry policy
- duplicate-effect policy
- billing reservation/settlement behavior

Required identities:
`runId`, `stepId`, `toolCallId`, `attemptId`, `idempotencyKey`, `effectFingerprint`.

Acceptance:
- SSE reconnect, fallback, worker restart, user resend, and retry do not duplicate task/note/project/binding/generation/billing effects;
- DB unique constraints or equivalent server enforcement exist where exactly-once effect is required.

### FIX-18 — Run control keyed too coarsely by group

**Severity:** P0/P1
**Status:** PROVEN_BY_CURRENT_CODE candidate if controller/end APIs remain group-keyed.

Required structure:
`groupId → conversationId → runId → attemptId → controller`.

Replace ambiguous lifecycle calls with run-specific APIs:
- `abortRun(runId)`
- `endRun(runId)`
- `pauseRun(runId)`
- `resumeRun(runId)`

Acceptance:
- old run finalizers cannot alter a newer run;
- rapid resend/double click cannot orphan an earlier controller;
- stale callback is ignored by run identity.

### FIX-19 — Active Goal not fully durable across refresh/redeploy

**Severity:** P1

Module memory may support panel close/route changes but not refresh, process restart, redeploy, or device change.

Durable server truth must include bounded:
- conversation
- run
- goal
- plan revision
- steps
- result refs
- verification receipts

Acceptance:
- refresh/reconnect/restart restores exact state without replaying verified effects;
- client cache is never authorization/source-of-truth.

### FIX-20 — Prompt/Tool Injection from external content

**Severity:** P0 Security

Treat Drive files, URLs, PDFs, web pages, external AI output, and imported text as untrusted data.

Introduce trust labels:
- SYSTEM
- USER_EXPLICIT
- VERIFIED_INTERNAL
- EXTERNAL_UNTRUSTED
- GENERATED_UNTRUSTED

External content may inform reasoning but must never elevate permission, confirmation, risk, or tool scope.

Acceptance:
- prompt-injection corpus cannot cause unauthorized tool execution;
- untrusted content cannot override system/user policy;
- provenance is preserved in evidence.

### FIX-21 — URL Import SSRF surface

**Severity:** P0 Security

Validate server-side URL fetching against:
- localhost/loopback
- RFC1918/private ranges
- link-local / metadata endpoints
- non-http(s) schemes
- redirect-to-private targets
- DNS rebinding patterns

Acceptance:
- blocked targets fail closed;
- egress/scheme/IP/domain policy is enforced server-side;
- redirects are revalidated.

### FIX-22 — Browser risk policy too coarse

**Severity:** P0

Do not treat all browser work as one `BROWSER_FALLBACK` risk class.

Split effects at least into:
- observe/read
- navigate
- download
- form fill
- submit
- send message
- publish
- purchase
- delete
- OAuth/login takeover

Confirmation must follow final effect risk, not simply browser usage.

Acceptance:
- read/navigation can proceed per low-risk policy;
- external messaging/publishing/purchase/destructive steps require explicit confirmation;
- browser provider unavailability stays honest.

### FIX-23 — Recursive Assistant-as-tool loop risk

**Severity:** P1

Any capability whose handler re-enters a general Assistant entrypoint must be audited for recursion, hidden billing, context explosion, and repeated planning.

Required guards:
- `parentRunId` / `childRunId`
- `maxAgentDepth`
- visited capability loop detection
- child budget
- child step cap

Prefer dedicated service/tool handlers over recursively calling a top-level assistant when practical.

### FIX-24 — Missing durable Execution Receipt as the source of completion truth

**Severity:** P0

Every real side effect must generate a receipt including:
- runId / stepId / toolCallId
- capabilityId / handler
- target type/ids
- requested/executed/verified timestamps
- before/after version where applicable
- provider job id / DB record ids
- verification method/status
- cost reservation/actual cost

Final `agent.completed` must reference verified receipts, never only model prose.

### FIX-25 — DB correctness beyond simple CRUD

**Severity:** P0

Test:
- tenant/group isolation
- project isolation
- cross-project binding rejection
- viewer/read-only mutation denial
- stale/deleted entity handling
- transaction rollback on partial failure
- retry duplicate protection
- concurrent updates/version conflicts

Acceptance:
- no cross-tenant IDOR path;
- failed multi-step transaction does not leave unauthorized/partial effects unless explicitly modeled;
- independent read-back agrees with Agent claim.

### FIX-26 — Deployment SHA / schema / capability drift must gate readiness

**Severity:** P0

Expose deployment identity:
- git SHA
- build time
- app version
- schema version
- capability registry hash

Deployment validation must compare expected vs live values.

Acceptance:
- live SHA mismatch = `DEPLOYMENT_DRIFT`, readiness fails;
- schema/capability hash mismatch is observable and blocks certification where relevant.

### FIX-27 — Provider selection must be health-aware, not static default-only

**Severity:** P1

Track rolling provider health:
- success rate
- timeout rate
- p50/p95/p99 latency
- concurrency/load
- circuit state
- last failure
- estimated cost

Routing should consider:
`task quality × latency × user budget × provider health × capability support`.

Acceptance:
- unhealthy provider is automatically penalized/circuit-broken;
- fallback never violates explicit cost/quality constraints;
- no silent paid fallback when forbidden.

### FIX-28 — Missing end-to-end trace correlation

**Severity:** P1

Add correlation across:
- traceId
- conversationId
- runId
- goalId
- stepId
- toolCallId
- providerRequestId
- dbTransactionId

Acceptance:
- one user request can be traced through planner → tool → service → DB/provider → verifier;
- metrics/logs do not require guessing from timestamps.

### FIX-29 — Child agents must not inherit unrestricted parent authority

**Severity:** P0

Each child delegation must receive bounded:
- allowed capabilities
- allowed project/source/entity scope
- max cost
- max steps
- expiry
- cancellation link

Acceptance:
- child cannot mutate outside parent-granted scope;
- child prompt injection cannot gain new tools;
- child cost cannot exceed parent envelope.

### FIX-30 — Persistent memory poisoning / stale-truth risk

**Severity:** P0/P1

Every persisted memory/decision/context item should retain:
- value
- source
- source type
- created by
- verified flag
- confidence
- scope
- expiry/version

Acceptance:
- external/generated memory is not treated as system truth;
- stale memory can be invalidated/revalidated;
- cross-project memory never leaks.

### FIX-31 — UI state must mirror runtime state, not vague spinner states

**Severity:** P1

Support explicit states:
- UNDERSTANDING
- RESOLVING
- WAITING_USER
- WAITING_PERMISSION
- QUEUED
- EXECUTING
- RETRYING
- REPLANNING
- VERIFYING
- PARTIAL_SUCCESS
- COMPLETED
- FAILED
- STOPPED
- BLOCKED_EXTERNAL

Mobile requirement: user must always know `what Aios is doing` and `whether Aios needs me now`.

### FIX-32 — Live Capability Certification must be a first-class runtime artifact

**Severity:** P0

Introduce a server-owned capability-health/certification view combining:
`Capability Registry + Runtime Health + Last Verification Evidence`.

Example fields:
- capabilityId
- declared
- handlerResolved
- authConnected
- providerHealthy
- lastVerifiedAt
- successRate
- p95Ms
- certificationState
- blockerReason

Planner must avoid BROKEN/unavailable tools automatically.

## Policy Kernel

LLM may propose actions. It must never be the final authority for:
- identity
- tenant/group/project access
- entity existence
- tool availability
- risk
- confirmation requirement
- billing
- destructive/external permissions

Deterministic server Policy Kernel evaluates:
`Identity → Tenant → ACL → Tool Scope → Risk → Cost → Confirmation → Trust Origin → ALLOW / DENY / CONFIRM`.

## Real environment validation requirements

### Accounts / credentials

Use dedicated QA credentials only:
- staging app user(s)
- dedicated QA Google account for Drive/Calendar/Photos when supported
- QA Fal/NVIDIA/provider keys with small budgets
- staging DB credential scoped to test data
- staging object-storage bucket/key
- real browser provider credential only if a provider is configured

Never paste secrets into prompts, logs, PR text, or source code. Load from Codespaces/GitHub Actions/deployment secrets.

### Database validation

Normal Agent execution must use real product API/service paths.
Independent QA verifier may query staging DB read-only to confirm effects.
Do not give the Agent raw production superuser SQL authority.

### Browser/Computer Runtime

Certification requires the complete lifecycle:
`status → createSession → observe/navigate/act → verify → stop → resource cleanup`.

Mock provider can validate code paths only. It cannot produce live certification.

### External integrations

For Drive/Calendar/Fal/NVIDIA/etc. distinguish:
- code path exists
- OAuth/key configured
- provider reachable
- real operation succeeds
- result persisted
- result read back
- user sees correct result

## Repeated validation protocol

Every P0/P1 fix must pass at least:

1. exact reproduction
2. semantic paraphrase / natural Chinese variation
3. adjacent edge case
4. reload/reconnect/route-change/retry variant when relevant
5. full relevant regression suite

For billing/idempotency/recovery defects, repeat the same flow multiple times and assert no duplicate side effect/charge.

Continue fresh-eye exploration until **two consecutive rounds discover no new P0/P1 defect**.

## Natural-language/adversarial corpus

Include:
- Traditional Chinese colloquial short replies
- typos
- mixed English/Chinese tool names
- interrogatives
- polite requests
- negation
- correction (`不是 Drive，是 Photos`)
- conditional instructions
- compound commands
- ambiguous referents (`這些`, `第二個`, `剛剛那個`)
- destructive/external/paid requests
- prompt injection embedded in project files/URLs/external output

Do not regress into brittle regex-only authority.

## Chaos / fault injection

Inject at least:
- SSE drop before payload
- SSE drop after partial payload
- tRPC fallback timeout
- provider 429 / 5xx / malformed response
- DB timeout
- stale entity id
- permission denied
- read-back mismatch
- worker restart
- process restart
- duplicate submit
- client reconnect
- circuit breaker open
- budget exhausted
- provider unavailable

Assert:
- no false completion
- no duplicate write
- no duplicate charge
- no cross-run ghost response
- no wrong active goal
- no permission bypass

## Observability / SLO candidates

These are acceptance targets for this project, not claims about current production state.

Correctness:
- 100% required registered tools pass handler contract
- 100% internal writes use read-back/authoritative verification
- 0 known false-completion paths
- 0 known cross-tenant access paths
- 0 duplicate side effects in retry/reconnect suite

Reliability:
- internal tool success target >= 99.5% in staging soak
- first visible Agent event P95 target < 1.5s
- core internal flow P95 target < 10s excluding media generation
- provider timeouts governed by circuit breaker/health routing

Practicality:
- each core Golden Flow >= 16/20 on the 10-dimension practicality scorecard from Issue #646
- no individual dimension = 0

## Golden flows to certify

1. `幫我把北藝回顧影片做到今天能交`
2. `把這些文件整理成分鏡放進目前專案`
3. `把剛匯入的五張圖整理後放第三鏡`
4. `找出沒有素材的鏡頭並建立待辦`
5. `不要超過 100 點，用品質最好的可用模型完成`
6. `把研究、整理素材、檢查分鏡同時做`
7. Browser unavailable vs real-provider configured flows
8. Drive intake → persisted assets → verified binding → continuation
9. stop/pause/resume/reload/restart/reconnect variants
10. cross-tenant / read-only / stale-id negative flows

## Production readiness gate

Do not mark Ready for Review merely because CI is green.

Required:
- no open P0
- no known false completion
- no known duplicate billing/write path
- no known cross-tenant/IDOR path
- all required internal capabilities >= STAGING_VERIFIED
- external capabilities honestly marked live-verified, degraded, or blocked
- core Golden Flows meet practicality threshold
- two consecutive fresh-eye rounds with no new P0/P1
- typecheck/tests/build/boundary/security suites pass
- live deployment SHA/schema/capability identity matches expected release during smoke validation

## Codex / GPT-5.6 Sol execution directive

Work directly on this branch. Do not just write docs or a plan.

Execution order:

1. Audit merged PR #645 and latest base.
2. Build the complete capability inventory from the real server-owned registry.
3. Generate the Live Capability Verification Matrix.
4. Confirm FIX-15..32 against current code; reclassify each as proven/risk/needs-live-verification.
5. Implement missing P0/P1 hardening in small coherent commits.
6. Add the lowest-cost regression test for every fixed bug plus E2E where integration-specific.
7. Add staging/live verification harnesses without hardcoding secrets.
8. Run repeated natural-language, fault-injection, reconnect, idempotency, ACL, and mobile rounds.
9. Record evidence and certification state for every capability.
10. Repeat fresh-eye + soak/chaos until the stability gate is met.
11. Run `npm ci`, typecheck, relevant tests/full agent suite, build, boundary/security checks.
12. Self-review for ACL, billing, races, duplicate effects, prompt/tool injection, SSRF, stale runs, deployment drift.
13. Push all fixes to this same PR branch. Do not open a second PR and do not merge automatically.

Normal engineering operations should proceed autonomously. Stop only for missing external credentials, real payment, destructive production data changes, or a genuinely non-resolvable product-direction decision.
