# Aios Agent v5 — Database Certification & Integrity Hardening

## Purpose

This document is the database-specific implementation and verification contract for PR #655.

The goal is not merely to prove that CRUD endpoints return 200. It is to prove that every Agent side effect is persisted to the correct tenant/project, remains consistent under retries/reconnects/restarts/concurrency, is billed exactly once, can be independently read back, and can be safely migrated/recovered.

Database proof path:

`Agent intent → server authorization → tool execution → transaction/constraint enforcement → authoritative persistence → receipt/effect linkage → independent read-back → audit/trace correlation → user-visible result`

A database-backed Agent tool is not certified until the actual stored state matches the Agent claim.

## Current implementation evidence to audit

The current Agent database layer already includes important primitives that must be validated rather than assumed:

- `agent_runs` persists project/group/user ownership, goal, status, context slots, steps, estimated points, and timestamps.
- `agent_events` and `group_agent_events` use unique `(runId,eventKey)` constraints for event deduplication.
- `agent_tool_receipts` stores `run_id`, global `idempotency_key`, `tool_id`, result JSON, reserved/actual points, settlement state, verification timestamp, and has a unique idempotency index.
- `AgentRunLedger` uses `onConflictDoNothing` for one-time reservation, conditional updates for verification and settlement, and treats `agent_runs` as the run source of truth.

These are useful foundations, but they must be tested for transactional boundaries, authorization scope, crash windows, stale state, and real billing/data consistency.

## Database certification dimensions

Every DB-backed capability must be tested across all of these dimensions:

1. **Identity correctness** — userId/groupId/projectId/target ids are server-resolved and match the authenticated principal.
2. **Tenant isolation** — no query or write can cross group/project ownership boundaries through guessed IDs.
3. **Transaction atomicity** — multi-record effects are either fully committed or explicitly modeled as partial/compensatable states.
4. **Idempotency** — retry/reconnect/restart cannot create duplicate business effects.
5. **Billing consistency** — point reservation, actual charge, refund/settlement, and business effect cannot diverge silently.
6. **Read-after-write verification** — user-visible completion requires authoritative re-read of the expected state.
7. **Concurrency correctness** — simultaneous Agent/user/worker writes cannot silently overwrite newer state.
8. **Referential integrity** — stale/deleted/mismatched entity IDs cannot create orphan or cross-project references.
9. **Migration compatibility** — schema changes are forwards/backwards safe for rolling deploys where required.
10. **Recovery** — backup/restore and crash recovery preserve Agent receipts, billing truth, and business data relationships.
11. **Performance** — Agent queries use appropriate indexes and do not cause unbounded table scans/locks under realistic load.
12. **Auditability** — runId/stepId/toolCallId/effect ids can be correlated with database rows and verification evidence.

## New database defect candidates — DB-FIX-01 onward

### DB-FIX-01 — Receipt idempotency key is globally unique without explicit scope contract

**Severity:** P0
**Evidence:** `agent_tool_receipts.idempotency_key` has a global unique index.

Risk:
- global uniqueness is useful for preventing duplicates, but the key generation contract must guarantee collision resistance across tenants/runs/tools;
- if a client-derived or insufficiently namespaced key collides, an unrelated run could be incorrectly treated as already executed;
- if the key format changes across deploys, replay/recovery semantics can break.

Required implementation/audit:
- define a canonical server-only key format such as `v1:{tenant/group}:{runId}:{stepId}:{toolId}:{effectFingerprint}`;
- never trust a client-provided idempotency key as authority;
- version the key format;
- add collision and cross-tenant tests.

Acceptance:
- same logical effect retry returns the original receipt;
- different tenant/run/tool cannot collide;
- malformed/client-forged key cannot suppress another operation.

### DB-FIX-02 — Receipt reservation, business write, verification and billing settlement may span separate transactions

**Severity:** P0
**Status:** NEEDS_CODE_AND_STAGING_VERIFICATION

`AgentRunLedger` currently exposes separate reserve/saveEffect/settle operations. This creates possible crash windows unless higher layers explicitly model them.

Critical crash cases:
1. reservation committed → process dies before business effect;
2. business effect committed → process dies before `saveEffect`;
3. receipt verified → process dies before billing settlement;
4. billing settles → response/event write fails;
5. external provider accepts paid job → local transaction dies.

Required architecture:
- document transaction boundary for each tool class;
- internal DB-only effects should prefer one DB transaction containing authorization re-check + business write + receipt/effect marker when feasible;
- external effects must use durable outbox/job/provider ids and recovery logic;
- recovery must distinguish `reserved`, `effect_unknown`, `effect_verified`, `settlement_pending`, `settled`.

Acceptance:
- fault injection at every boundary produces neither lost verified work nor duplicate writes/charges;
- recovery can reconcile every non-terminal receipt state.

### DB-FIX-03 — Receipt table lacks explicit group/project/user ownership columns

**Severity:** P0/P1

Current receipt linkage is primarily by `run_id`. That can be valid if every access joins through authoritative `agent_runs`, but this invariant must be enforced consistently.

Risk:
- convenience queries may fetch receipt by idempotency key without joining/checking run ownership;
- operational/debug endpoints may expose cross-tenant result JSON if authorization is omitted.

Required fix/audit:
- inventory every receipt read/write path;
- require authorization via run ownership or denormalize immutable ownership fields if operationally justified;
- never expose receipt result solely by receipt/idempotency key without ACL re-resolution.

Acceptance:
- cross-group receipt lookup is denied in API/service tests;
- direct internal helper cannot bypass ownership checks accidentally.

### DB-FIX-04 — `saveEffect` conditional update can silently update zero rows

**Severity:** P1

If no matching unverified receipt exists, `saveEffect` may perform zero updates while caller assumes persistence succeeded.

Required change:
- return an explicit outcome (`saved`, `already_verified`, `missing_receipt`, `conflict`);
- treat unexpected zero-row updates as a verification/recovery error, not success;
- log/metric the anomaly.

Acceptance:
- missing receipt cannot lead to `agent.completed`;
- stale duplicate verifier returns deterministic existing effect.

### DB-FIX-05 — `settleOnce` does not visibly bind `_runId` in the update predicate

**Severity:** P0/P1
**Evidence:** current adapter updates by idempotency key + unsettled state; `_runId` is unused.

Risk:
- correctness relies entirely on global key uniqueness;
- a bug/collision in key generation could settle a receipt belonging to another run.

Required change:
- include runId in receipt lookup/update predicates even with a unique idempotency key;
- assert the receipt tool/run identity before settlement;
- add invariant tests.

Acceptance:
- wrong runId can never settle another run's receipt.

### DB-FIX-06 — Business effect fingerprint is not first-class in receipt schema

**Severity:** P1

A key can deduplicate execution, but reconciliation also needs to know what business effect was expected.

Add fields or a typed result contract for:
- effect type
- target table/entity ids
- expected state/version
- provider job id
- before/after version/hash where practical
- verification method
- verification status/error

Acceptance:
- operator/repair worker can independently reconcile a receipt against authoritative data.

### DB-FIX-07 — JSONB `agent_runs.steps` is a concurrency hotspot

**Severity:** P0/P1

The runner stores the whole steps array in one JSONB column. Concurrent runner/recovery/human-control updates can create lost-update risk if updates are read-modify-write without version checks.

Required investigation:
- enumerate every writer of `agent_runs.steps`, status/currentStep/contextSlots;
- introduce optimistic concurrency (`version`/`lock_version`) or row locking where appropriate;
- prefer normalized step rows if write contention/recovery requirements exceed safe JSONB snapshot semantics.

Acceptance:
- two concurrent updates cannot silently overwrite each other's newer step state;
- pause/stop/resume racing with runner execution is deterministic.

### DB-FIX-08 — Run state machine transitions need database-level concurrency enforcement

**Severity:** P0

Examples to test:
- running → stopped while worker tries running → done;
- paused → resumed while stale worker writes failed;
- waiting_confirmation answer races with stop;
- same answer submitted twice.

Required change:
- transition updates must include expected prior state/version in `WHERE` clause;
- zero-row transition means stale/conflict, never silent success;
- consider explicit state transition helper used by all callers.

Acceptance:
- terminal `stopped/failed/done` cannot be overwritten by stale worker state;
- duplicate human answers are idempotent.

### DB-FIX-09 — Tenant isolation must be proven at query layer, not inferred from UUIDs

**Severity:** P0 Security

Build adversarial tests for every Agent DB tool:
- authenticated Group A user supplies Group B project/task/asset/shot/database/run/receipt UUID;
- current page project differs from explicit target;
- child agent is scoped to Project A but receives Project B ids.

Required invariant:
`entity id + authenticated user/group + capability scope` must resolve server-side before every read/write.

Acceptance:
- 0 cross-tenant reads/writes across the full capability matrix;
- IDOR suite runs in CI and staging.

### DB-FIX-10 — Cross-project referential integrity for context bindings

**Severity:** P0

For asset → project/scene/shot bindings, prove that:
- asset is visible to same authorized group/project context;
- shot/scene belongs to target project;
- stale/deleted entity cannot be bound;
- duplicate binding behavior is intentional/idempotent.

Acceptance:
- Project A asset cannot be attached to unauthorized Project B shot by forged ids;
- read-back verifies exact binding count/ids.

### DB-FIX-11 — Multi-row Agent operations need transaction/compensation contracts

**Severity:** P0/P1

Examples:
- create project + note + task;
- import asset + project binding + intelligence job;
- split script + scenes/shots;
- schedule item + external calendar sync;
- generation record + billing + asset persistence.

For each workflow classify:
- atomic DB transaction;
- saga/compensating transaction;
- asynchronous durable workflow.

Acceptance:
- partial failure state is explicit and recoverable;
- Agent never reports the whole workflow complete if only early rows committed.

### DB-FIX-12 — Point accounting must be reconciled against receipts and business effects

**Severity:** P0

Required invariants:
- one billable logical tool call → at most one settlement;
- failed/aborted-before-provider-acceptance → no final charge or explicit refund;
- provider accepted paid job → charge state remains traceable even if local run stops;
- `actual_points` matches authoritative points ledger transaction;
- retries do not reserve/settle twice.

Add reconciliation query/job:
- receipts settled without billing row;
- billing row without receipt/effect;
- reserved too long;
- actual < 0 or > policy max;
- run total != receipt/points totals.

Acceptance:
- reconciliation returns zero unexplained mismatches in staging soak.

### DB-FIX-13 — Independent read-back must not reuse the same buggy write-path assumptions

**Severity:** P1

Verification should query authoritative state through a separate read model/service or independent QA verifier, not merely trust the write response/result JSON.

Acceptance:
- injected fake success response with no DB write fails verification;
- injected wrong projectId write is detected.

### DB-FIX-14 — Database timeouts/connection loss need explicit retry classification

**Severity:** P1

Not every DB error is retry-safe.

Classify at minimum:
- connection acquisition timeout
- serialization/deadlock retry
- unique violation (likely idempotency/conflict)
- foreign key violation (bad/stale target)
- permission/ACL denial (never retry blindly)
- statement timeout
- database unavailable

Acceptance:
- only transient retry-safe errors retry automatically;
- retries use the same idempotency identity;
- permanent errors surface exact blocker.

### DB-FIX-15 — Deadlock/serialization/concurrent-write chaos testing

**Severity:** P1

Create concurrency tests with parallel Agent actions on the same project/run/shot/task/budget.

Inject:
- concurrent create same logical task;
- attach same assets simultaneously;
- pause + worker completion race;
- settle same receipt concurrently;
- two workers claim same queued work.

Acceptance:
- no duplicate business effect;
- no lost update;
- deterministic winner/conflict result.

### DB-FIX-16 — Foreign keys and delete behavior must match Agent semantics

**Severity:** P1

Inventory Agent-domain tables for missing database-level FKs or intentionally application-enforced references.

For each relationship document:
- FK exists / intentionally absent;
- ON DELETE behavior;
- archival/soft-delete behavior;
- how verifier handles deleted targets.

Acceptance:
- deleting/archiving project/user/asset does not leave dangerous orphan Agent state or expose stale data.

### DB-FIX-17 — Schema migration readiness and rolling deploy compatibility

**Severity:** P0/P1

Every migration affecting Agent runtime must test:
- upgrade from previous production schema snapshot;
- app old-version ↔ new-schema compatibility during deploy window where platform can overlap versions;
- migration restart/idempotency;
- rollback strategy for code even when DB migration is forward-only;
- large-table lock duration.

Acceptance:
- staging clone migration succeeds from production-like dataset;
- `/health` reports schema version expected by app build;
- app refuses readiness on incompatible schema.

### DB-FIX-18 — Migration drift detection

**Severity:** P0

Deployment identity should expose:
- git SHA
- schema/migration version
- capability registry hash

CI/CD must compare expected migration state to live.

Acceptance:
- code deployed without required migration = not ready;
- unexpected live migration ahead/behind is visible as `SCHEMA_DRIFT`.

### DB-FIX-19 — Index/plan regression for Agent workload

**Severity:** P1

Audit production-like query plans for:
- recent runs by group/user/project/status;
- event timeline by run/project;
- receipt lookup by idempotency/run;
- pending questions/watches/jobs;
- project file/search binding queries;
- certification/health aggregation.

Use `EXPLAIN (ANALYZE, BUFFERS)` in staging with representative volume.

Acceptance:
- no obvious full scan on hot-path large tables when a bounded indexed query is expected;
- define query latency budgets and row-count assumptions.

### DB-FIX-20 — Connection pool exhaustion / long transaction risk

**Severity:** P1

Test:
- concurrent long-running Agent requests;
- provider call must not hold DB transaction/connection open unnecessarily;
- worker bursts;
- slow verifier;
- pool saturation.

Acceptance:
- external LLM/provider/browser network waits occur outside DB transactions unless technically required;
- connection acquisition P95 and waiting count stay within staging SLO.

### DB-FIX-21 — Audit/event retention and data volume growth

**Severity:** P1

Agent events, receipts, runs, questions, traces and result JSON will grow continuously.

Define:
- retention policy
- archival policy
- sensitive payload minimization
- max JSON result size
- indexes after archival
- deletion requirements for account/group removal.

Acceptance:
- no unbounded large provider payloads stored in receipt/event JSON;
- retention jobs cannot break read-back/audit invariants for active disputes/runs.

### DB-FIX-22 — PII/secrets must never land in Agent DB telemetry/results

**Severity:** P0 Security

Test that:
- API keys/OAuth tokens/cookies/passwords are redacted before `result`, events, planner telemetry, traces, errors;
- external provider response headers are not blindly persisted;
- SQL/query errors do not leak secrets to user-facing events.

Acceptance:
- seeded canary secrets never appear in Agent DB tables/log exports.

### DB-FIX-23 — Backup/restore must preserve relational truth

**Severity:** P1/P0 operational

A restore must preserve consistency among:
- projects/assets/storyboards/tasks
- agent_runs/steps
- agent_events/questions
- tool receipts
- points ledger
- storage object references

Required drill:
1. create known Agent workflow state;
2. take DB + object-storage backup pair;
3. mutate/delete test data;
4. restore into isolated environment;
5. run integrity verifier;
6. ensure no duplicate rerun/charge after restored Agent resumes.

Acceptance:
- restored verified effects are recognized and not replayed.

### DB-FIX-24 — Data corruption / invariant scanner

**Severity:** P1

Add read-only integrity report for:
- receipt run missing
- verified receipt with missing business effect
- settled receipt without billing transaction
- done run containing unverified required step
- active question on terminal run
- cross-project binding mismatch
- orphan events/questions
- stale running runs beyond lease threshold
- duplicate logical effects

Acceptance:
- scheduled/CI/staging scanner returns actionable counts and identifiers;
- critical invariant violations block certification.

## Required staging database topology

Do not use production superuser credentials for Agent validation.

Recommended:
- isolated staging PostgreSQL cloned/anonymized or seeded with representative data;
- QA app role with the same application permissions as production app role;
- optional separate read-only verifier role for independent assertions;
- dedicated test group/project/users across at least two tenants;
- staging object-storage bucket/volume paired with the DB dataset.

Roles:

1. **App role** — normal AIOS backend path; this is what Agent execution uses.
2. **Verifier role** — read-only QA process; can independently inspect expected rows.
3. **Migration role** — only CI/deployment migration job, not Agent runtime.

## Two-tenant adversarial fixture

Seed at least:

- Tenant/Group A: Owner A, Editor A, Viewer A, Project A1/A2, assets, shots, tasks, database rows.
- Tenant/Group B: Owner B, Project B1, assets, shots, tasks.

Generate and retain deterministic fixture IDs for test harness only.

Mandatory attacks:
- A supplies B projectId to every read tool;
- A supplies B assetId/shotId/taskId/runId/receipt id;
- Viewer A attempts every write capability;
- child Agent scoped A1 attempts A2/B1;
- stale/deleted ids;
- random UUIDs.

Expected: fail closed with no existence leak beyond policy.

## Transaction matrix

For every write capability, create a row with:

- capabilityId
- tables touched
- transaction type (`single_tx`, `saga`, `async_job`, `external_effect`)
- idempotency key location
- unique constraints
- expected read-back query
- billing coupling
- crash recovery strategy
- compensation behavior
- retry-safe errors
- permanent errors

This matrix is required for certification, not optional documentation.

## Authoritative read-back examples

### create_task

`Agent → create task → DB task row → independent select by taskId + projectId + group ACL → fields match → receipt verified → complete`

### attach_asset_to_shot

`Agent → validate project/shot/assets → binding transaction → independent query exact asset/shot bindings → count and ids match expected → complete`

### import file/Drive

`Agent → intake job → storage persisted → asset row → project binding → indexing state → independent read-back → only then satisfy a goal that required usable imported assets`

### paid generation

`Agent → cost reservation → generation request accepted → durable provider job id → generation row → output asset persistence → verification → actual billing settlement → reconciliation`

## Database chaos suite

Automate fault injection around transaction boundaries:

- kill worker after receipt reserve;
- kill worker immediately after business COMMIT;
- kill worker before verification receipt update;
- kill after verified receipt, before settlement;
- DB connection timeout before write;
- statement timeout during write;
- simulated serialization/deadlock;
- duplicate client submission;
- duplicate worker delivery;
- stale worker completion after stop;
- provider callback delivered twice;
- migration applied while old app instance still serves traffic (staging only).

For every scenario assert:
- no duplicate write;
- no duplicate charge;
- no false completion;
- recoverable state remains discoverable;
- tenant boundaries remain intact.

## Database observability

Add/verify metrics without exposing sensitive data:

- DB pool total/idle/waiting
- query/transaction latency by operation class
- transaction retry count
- deadlock/serialization count
- receipt reserve conflicts
- receipt settlement conflicts
- receipt reconciliation mismatch count
- stale run count
- stale reserved receipt count
- verification failure count
- schema drift state
- migration version
- integrity scanner critical count

Correlate structured logs with:
- traceId
- runId
- stepId
- toolCallId
- dbTransactionId (logical id; do not expose DB internals unnecessarily)
- receiptId

## Database SLO / readiness candidates

These are project acceptance targets, not claims about current production.

Correctness:
- 0 cross-tenant reads/writes in adversarial suite
- 0 duplicate logical effects across retry/reconnect/restart chaos suite
- 0 duplicate settlements/charges
- 100% required internal writes have authoritative read-back
- 0 `done` runs with missing required verified effects

Integrity:
- receipt reconciliation unexplained mismatch = 0
- critical invariant scanner count = 0
- migration/schema drift = 0 at production readiness

Performance in staging representative load:
- hot DB query P95 target defined and measured per operation class
- pool waiting sustained = 0 under expected baseline load
- no external provider call holds an unnecessary DB transaction open

Recovery:
- backup/restore drill passes
- restored verified effect is not replayed
- crash-window suite recovers without manual row edits

## Codex implementation/verification order

1. inventory all Agent DB tables and all DB-backed capabilities;
2. map each write tool to exact tables, transactions, constraints, billing and verifier;
3. audit `agent_tool_receipts` and `AgentRunLedger` against DB-FIX-01..06;
4. audit run state concurrency against DB-FIX-07..08;
5. build two-tenant ACL/IDOR suite;
6. build transaction/idempotency/crash-window tests;
7. build billing reconciliation tests;
8. build integrity scanner;
9. audit migrations/schema drift/readiness;
10. run query-plan/load/pool tests;
11. run backup/restore drill in isolated staging;
12. execute multiple fresh-eye rounds and add every discovered DB defect with evidence;
13. only then update capability certification states.

Do not mark a capability `STAGING_VERIFIED` merely because its API returns success. The authoritative database state, ownership, receipt, billing, and verification evidence must all agree.
