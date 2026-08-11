# Aios Agent v5 certification evidence — PR #655

Last updated: 2026-08-12 (Asia/Taipei)

This file is the review index for executable evidence. It does not promote local or mock results to staging/live. The server-owned matrix at `agents.practicalCapabilityHealth` remains the source of certification truth.

## Current gate

- Required handler contract: **PASS**, 4 declared tools, 0 dangling handlers, 0 dangling skills.
- Fresh PostgreSQL 0000 → 0070: **PASS**, 71 migrations, 128 public tables, schema drift 0.
- Fresh DB integrity: **PASS**, critical 0, warning 0.
- Local Command Center E2E: **PASS**, Direct create → Direct URL intake → recent-result read → user-click navigation → conversation restore.
- Local fault/soak: **PASS**, 1,000 runs, 1,000 unique effects, 333 concurrent duplicate blocks, 71 uncertain-outcome reconciliation resumes.
- Isolated DB + object backup/restore: **PASS**, 338,521-byte PostgreSQL dump, object SHA-256 `6CB39D958945C1B1633324F5628E98362A9C83E150F5D28842EC5EB8E40A8B2E`, restored verified effect was not replayed, second settlement rejected, critical integrity 0.
- Live capability certification: **NOT YET AT GATE**. The committed artifact is explicitly `MOCK_VERIFIED`; no staging app/verifier credentials or representative bound file id are available in this workspace.
- PR state: keep **Draft**. `required internal capabilities >= STAGING_VERIFIED` and deployment identity smoke are externally blocked, so Ready for Review must not be claimed.

## Capability verification matrix

| Capability | Handler | Execution | Verification | Local evidence | Honest state |
|---|---|---|---|---|---|
| `project.health` | `projectIntelligence.buildProjectIntelligence` | direct read | authoritative project-state read-back | receipt + mock product API | `MOCK_VERIFIED` |
| `project.files.list` | `agentProjectFiles.listProjectFiles` | direct read | bound table + AI ACL read-back | receipt + mock product API | `MOCK_VERIFIED` |
| `project.files.search` | `agentProjectFiles.searchProjectFiles` | direct read | bound table + scoped query read-back | receipt + mock product API | `MOCK_VERIFIED` |
| `project.files.read` | `agentProjectFiles.readProjectFile` | direct read | exact file id inside authorized bound table | contract only; QA project lacks representative bound file | `DECLARED_ONLY` |

All four require `userId`, `groupId`, and `projectId`. Runtime checks durable run owner scope before handler/billing; each handler re-resolves the project group and authenticated membership. Mock evidence can never enter a live state. Staging/live execution now fails the harness unless all required tools pass all six proof layers.

## FIX-15–32 disposition

| Fix | Classification after implementation | Evidence / remaining requirement |
|---|---|---|
| FIX-15 registry/runtime drift | `PROVEN_BY_CURRENT_CODE` → fixed locally | registry hash, handler identity, skill contract, readiness gate; 0 dangling |
| FIX-16 queued ≠ complete | `PROVEN_BY_CURRENT_CODE` → fixed locally | writes cannot register queue/running as completion; verified receipt required |
| FIX-17 idempotency contract | `LIKELY_ARCHITECTURAL_RISK` → hardened | versioned tenant/run/step/tool/fingerprint key; lease/receipt replay tests |
| FIX-18 coarse run control | `PROVEN_BY_CURRENT_CODE` → fixed | exact run + attempt controller; stale finalizer and concurrent duplicate tests |
| FIX-19 refresh/redeploy durability | `PROVEN_BY_LIVE_REPRO` → fixed locally | durable Assistant checkpoint + route hydration + exact run/attempt store |
| FIX-20 external prompt/tool injection | `LIKELY_ARCHITECTURAL_RISK` → hardened | trust labels cannot waive confirmation; untrusted recursion/policy tests |
| FIX-21 URL SSRF | `PROVEN_BY_CURRENT_CODE` → fixed | fail-closed DNS/IP/redirect validation and regression suite |
| FIX-22 browser risk policy | `PROVEN_BY_CURRENT_CODE` → fixed | semantic effect risk and confirmation; browser remains fallback |
| FIX-23 recursive Assistant loop | `LIKELY_ARCHITECTURAL_RISK` → fixed | visited-capability/depth guards and bounded delegation |
| FIX-24 durable receipt truth | `PROVEN_BY_CURRENT_CODE` → fixed | correlated receipt, read-back stage, target refs, durable recovery |
| FIX-25 DB correctness | `PROVEN_BY_LIVE_REPRO` → locally hardened | PG concurrency/ACL/integrity/restore; representative staging still required |
| FIX-26 deployment drift | `NEEDS_STAGING_VERIFICATION` | `/health` and `/ready` expose SHA/schema/registry; expected identity gates readiness |
| FIX-27 health-aware routing | `LIKELY_ARCHITECTURAL_RISK` → fixed | circuit metrics, latency/load/reliability scoring, cost/capability constraints |
| FIX-28 trace correlation | `PROVEN_BY_CURRENT_CODE` → fixed | goal/conversation/run/step/toolCall/attempt/trace in receipt |
| FIX-29 child authority | `LIKELY_ARCHITECTURAL_RISK` → fixed | group/project/capability/step/cost/depth/expiry envelope tests |
| FIX-30 memory poisoning/stale truth | `PROVEN_BY_LIVE_REPRO` → fixed locally | bounded recent results; only verified results become referents |
| FIX-31 runtime/UI state | `PROVEN_BY_LIVE_REPRO` → fixed locally | explicit runtime state mapping, queued next turn, persistent conversation |
| FIX-32 first-class certification | `NEEDS_STAGING_VERIFICATION` | durable matrix, anti-spoof modes, staleness/SHA/schema/registry degradation |

## DB-FIX-01–24 disposition

| Track | Result |
|---|---|
| 01 key scope/collision | versioned server key contains tenant, run, step, tool and canonical fingerprint; forged collision fails |
| 02 crash windows | durable lease/receipt + handler idempotency + explicit reconciliation; generic external effects remain saga-based |
| 03 receipt ownership | first-class user/group/project columns, reviewed backfill, tenant indexes, mismatch scanner |
| 04 zero-row save | `saveEffect` returns false unless exact run/key/lease owner updated one row |
| 05 settlement scope | exact run + key + verified + unsettled predicate; wrong run and duplicate settlement tests |
| 06 effect fingerprint | first-class column and identity-conflict enforcement |
| 07 JSON concurrency | first-class `lock_version`; concurrent whole-run saves allow exactly one winner |
| 08 state concurrency | optimistic database transition guard; stale pause/stop finalizer cannot overwrite |
| 09 tenant/IDOR | runtime owner binding, handler project-group re-resolution, existing ACL suites; staging two-tenant matrix still required |
| 10 cross-project bindings | integrity scanner checks scene/shot/asset/library project and group scope |
| 11 multi-row intake | Universal Intake remains canonical saga; duplicate bytes reuse canonical resource and add exact target usage |
| 12 points reconciliation | reserve-once/settle-once and point mismatch/stale-unsettled scanner; real paid-provider ledger requires QA budget |
| 13 independent read-back | verifier paths query authoritative project/binding/effect state rather than trusting handler text |
| 14 DB retry classes | only rollback-safe `40001`/`40P01` (or explicit pre-effect guarantee) auto-retry; uncertain outcomes reconcile |
| 15 chaos concurrency | PG lease/CAS tests plus 1,000-run duplicate/retry/reconciliation soak |
| 16 delete/FK semantics | scanner detects orphans and terminal-question corruption; schema behavior retained for rolling compatibility |
| 17 rolling migration | additive guarded 0070 migration; legacy receipt owner backfill is explicit/reviewed |
| 18 drift/tamper | exact ledger hash, accepted superseded revisions, fresh drift 0, CI tamper fail-closed |
| 19 plans/indexes | certified EXPLAIN plans for receipt/run/lease hot queries |
| 20 pool pressure | 80 concurrent bounded reads drain with waiting=0; `/ready` exposes total/idle/waiting |
| 21 retention/volume | bounded 500-row scanner and indexed lookup; production retention policy remains operational follow-up |
| 22 secrets/PII | receipt values/refs bounded and redacted; DB canary scanner and tests |
| 23 backup/restore | isolated DB + object pair drill; restored receipt recognized, effect/settlement not replayed |
| 24 invariant scanner | read-only scanner in CLI/router/readiness; critical violations block readiness |

## Write transaction matrix

| Capability family | Contract | Authoritative read-back | Recovery / compensation |
|---|---|---|---|
| `create_project` | app service transaction + typed result | project id + group ownership + fields | idempotent action result; no navigation side effect |
| notes/tasks/schedules | app command transaction | exact entity id inside project/group ACL | existing command idempotency; permanent ACL/constraint errors never replay |
| local/file/Drive/folder intake | Universal Intake saga + storage persistence | canonical resource, target usage/binding, scheduled intelligence job | canonical hash dedupe; persisted batch resumes background work |
| URL intake | Universal Intake saga | canonical resource + exact target project usage | SSRF fail-closed; duplicate URL reuses resource without losing target usage |
| asset context binding | scoped DB transaction | exact scene/shot/project binding | mismatch blocks completion; scanner catches corruption |
| paid generation/external effect | durable provider job/receipt saga | provider job + persisted output + billing reconciliation | explicit confirmation, same-key recovery, no blind retry on unknown commit |

## Executable evidence

- `.qa-evidence/agent-v5-live-certification.json` — local mock artifact; deliberately reports 0 live verified.
- `scripts/e2e-agent-live-certification.py` — authenticated product-API staging/live harness with environment identity anti-spoofing.
- `scripts/e2e-ui/verify-command-center.mjs` — conversation-home product E2E and user-initiated-only navigation.
- `scripts/agent-v5-soak.ts` — duplicate delivery, rollback-safe retry and uncertain-outcome reconciliation soak.
- `scripts/verify-agent-db-integrity.ts` — read-only invariant gate.
- `scripts/verify-agent-db-recovery.ts` — seed/verify halves of the isolated backup/restore non-replay drill.
- PostgreSQL integration tests cover receipt leases, exact settlement, forged identity, stale JSON save, integrity canaries, hot plans and pool pressure.

## Local validation ledger

| Gate | Result |
|---|---|
| `npm test` | PASS — 237 files, 2,690 passed, 22 files / 96 tests intentionally skipped by environment gates |
| `npm run test:client` | PASS — 200 files, 1,791 passed |
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| `npm run db:check` | PASS — 71 migrations, 128 public tables, schema drift none |
| `npm run check:boundaries` | PASS — 967 files, no new exception |
| `npm run check:ui-primitives` | PASS — bare class baseline 0 |
| `npm run check:hooks` | PASS |
| PostgreSQL certification tests | PASS — leases/CAS/owner status/integrity/query plans/pool/conversation isolation |
| `AGENT_SOAK_ROUNDS=1000 npm run test:agent:soak` | PASS — 1,142 handler calls, 142 injected failures, 71 reconciliation resumes, 333 duplicate blocks, 1,000 unique effects |
| `npm run verify:agent-db-integrity` after certification | PASS — critical 0, warning 0 |
| `/api/ready` after mock certification | HTTP 200 — DB pool total 5, idle 5, waiting 0; certification remains observe-only 0/4 live |
| `npm run verify:agent-live` (`mock`) | PASS path regression only — 3 executed, 4 declared, 0 live verified; `project.files.read` truthfully omitted without representative bound file |

## Defect exploration log

Round A found and fixed: queued next message silently dropped; generic project action shown after Direct create; duplicate conversation turns; import also created a second project; stale goal overrode “剛建立的專案”; duplicate URL failed target-project read-back; unverified results entered recent referents; “查看剛匯入資料” was misrouted as a new import.

Round B found and fixed: serialization retry was not distinguished from unknown commit; receipt payload could persist credentials; run owner was not bound to caller; receipt owner scope was indirect; timestamp CAS lost updates; result parser crashed on legacy action results; page modal z-index intercepted Persistent Assistant actions.

Round C found and fixed: the empty-project onboarding modal could open after the Assistant and retain competing dialog focus; the durable conversation service imported a router in violation of ADR-009; an unbounded jsdom worker count caused cascading false failures; and synchronous capability certification inserted a normal `running` run that the background Agent runner could concurrently claim and corrupt. Certification now owns a `user_controlled` run end-to-end, with a PostgreSQL round-trip regression; rerunning all mock capabilities leaves integrity 0/0 and readiness HTTP 200.

Two final clean fresh-eye rounds must still be recorded after staging credentials/data are supplied and the exact pushed deployment is exercised. Local clean rounds alone cannot satisfy the production readiness contract.
