# Aios Agent — 2h+ Long-Running Task Runtime

## Goal

Aios must reliably execute autonomous tasks lasting **at least 2 continuous hours**, with an architecture that can naturally extend to 8+ hours or multi-day workflows.

This is not a larger request timeout. Long tasks must be durable, resumable, idempotent, observable, budget-aware, and recoverable across process/worker/client failure.

Core contract:

`GOAL → DURABLE PLAN → QUEUE/DAG → LEASED EXECUTION → CHECKPOINT → VERIFY → RETRY/REPLAN → RESUME → VERIFIED DELIVERY`

## Independent scope

This work is separate from:
- PR #655: reliability/live/database certification
- PR #658: agent-initiated UI handoffs/pickers

Reuse Agent Brain v3 / Practical Autonomy v4 foundations. Do not build a second orchestration system.

## Minimum runtime target

A production-like soak must prove:
- one long task remains correct for **>= 2 hours**;
- recommended extended soak: 8 hours;
- architecture must not assume a fixed 2-hour ceiling;
- closing panel, route change, phone backgrounding, client disconnect, page refresh, worker restart, server restart, deploy, and provider transient failures do not lose verified progress;
- no duplicate side effect or duplicate billing during recovery;
- memory growth remains bounded over the full soak.

## Durable task state

Persist server-side truth for:
- taskId, runId, goalId, conversationId
- userId, groupId, projectId
- status, planRevision
- current milestone / current step
- durable step DAG and dependencies
- completed verified effects
- pending interaction/permission
- provider job ids
- retries / nextAttemptAt
- budget / reserved / actual points
- progress counters
- lease owner / lease expiry / heartbeat
- createdAt / updatedAt

Statuses should distinguish at least:
`PLANNING`, `QUEUED`, `RUNNING`, `WAITING_USER`, `WAITING_PERMISSION`, `WAITING_PROVIDER`, `RETRYING`, `REPLANNING`, `PAUSED`, `VERIFYING`, `PARTIAL_SUCCESS`, `COMPLETED`, `FAILED`, `STOPPED`, `BLOCKED_EXTERNAL`.

Client state is never the source of truth.

## Durable step DAG

Each step needs:
- stepId
- capabilityId/handler
- dependencies
- status
- attempt count
- stable idempotency key
- expected effect
- result refs
- verification refs
- provider job id
- estimated/reserved/actual points
- lease/version
- timestamps
- retry classification

Checkpoint after every meaningful verified effect. Never depend on one in-memory loop staying alive for two hours.

## Worker leases and stale-worker protection

Implement or harden worker ownership so that:
- a worker acquires a lease before executing a step;
- leases expire after worker death;
- another worker can resume safely;
- stale workers cannot finalize or overwrite newer state after lease loss;
- long provider calls heartbeat or persist provider job identity;
- two workers cannot concurrently execute the same non-idempotent effect;
- use optimistic versioning / compare-and-set / row locking where appropriate.

## Exactly-once side effects

SSE reconnect, UI resend, process restart, worker retry, provider timeout, deploy, and recovery must not duplicate:
- task/note/project creation
- asset binding
- imports
- generation jobs
- external messages/publish
- browser submits
- points/billing

If an external provider succeeded but local finalization crashed, recover from provider job status / execution receipt / read-back before deciding to retry.

## Background continuation

The task must continue server-side when policy permits even if the user:
- closes the assistant panel
- switches route/project
- backgrounds the mobile browser/app
- locks the phone
- loses network
- refreshes/reopens later

These are view lifecycle events, not execution cancellation.

## Pause / Resume / Stop

Pause:
- stop scheduling new steps;
- keep durable state;
- track already-accepted provider work honestly.

Resume:
- revalidate auth/ACL;
- revalidate entity refs and tool availability;
- reacquire lease;
- never replay verified effects.

Stop:
- terminal for future work;
- best-effort cancel cancellable provider calls;
- record non-cancellable external work already accepted;
- never report completed unless verified goal outcome already exists.

## Retry and replan

Classify failures:
- transient provider/network
- rate limit
- timeout
- stale context/entity
- permission
- budget
- permanent validation
- external human dependency

Recovery order:
1. safe retry if idempotent;
2. refresh state/context;
3. provider/tool fallback if policy allows;
4. replan remaining DAG;
5. ask user only for true blockers.

Use bounded attempts, jitter/backoff, circuit breakers, and retry budgets.

## Provider job polling

Long media/browser/external work must not hold HTTP/SSE open for hours.

Use persisted provider job ids and asynchronous polling/webhook-compatible adapters where available:
`submit → persist providerJobId → release request → worker polls/checks → persist progress → verify result`.

Do not tie provider completion to one client connection.

## Progress and summaries

User-facing long task UX should expose concise progress, not private chain-of-thought:
- current milestone
- completed / total steps
- current action
- waiting reason
- elapsed time
- last successful checkpoint
- estimated cost vs budget
- retries/replans count
- next required user action, if any

The user must be able to reopen after 2 hours and immediately understand the state.

## Context management for 2h+ tasks

Do not keep appending the full conversation/project into every LLM call.

Use:
- durable typed refs
- verified result refs
- compact milestone summaries
- targeted project/file retrieval
- bounded recent context
- plan revision summaries

Prevent token/context growth from scaling linearly with task duration.

## Budget guard

Long tasks need hard budget enforcement:
- explicit user max points/cost must be durable;
- reserve before paid work;
- settle once;
- retries cannot double charge;
- fallback cannot silently exceed budget;
- task pauses/blocks on exhausted budget instead of overspending.

## Human interaction during long tasks

When user input is truly required:
- persist an interaction/question tied to runId/stepId;
- transition to WAITING_USER / WAITING_PERMISSION;
- do not consume worker continuously while waiting;
- resume same run when answer arrives;
- stale answers must be rejected.

## Concurrency and sub-agents

Long tasks may parallelize independent read/research/analysis steps, but:
- bounded concurrency;
- child scope/capability/budget limits;
- parent owns final writes and completion;
- cancellation propagates;
- shared effects remain idempotent and centrally verified.

## Observability

Every long task must be traceable by:
- traceId
- taskId
- runId
- stepId
- attemptId
- toolCallId
- providerRequest/jobId
- db transaction/receipt refs where available

Metrics should include:
- active long tasks
- run age
- step latency
- lease expiration/recovery count
- retries/replans
- provider wait time
- duplicate-effect prevented count
- stuck-run count
- verification failures
- budget exhaustion
- memory/resource growth

## Stuck-run watchdog

Add a watchdog/reconciler that detects:
- RUNNING with expired lease
- provider job completed but local step not finalized
- no heartbeat beyond threshold
- WAITING_PROVIDER for excessive duration
- inconsistent receipt vs step state

The reconciler should recover safely or mark an explicit blocker; never silently leave tasks stuck forever.

## Required fault-injection scenarios

During a >=2h soak, deliberately inject:
1. client disconnect/reconnect
2. panel close/reopen
3. page refresh
4. route changes
5. worker restart
6. server restart
7. deployment during run
8. provider 429
9. provider 5xx
10. malformed provider response
11. DB timeout
12. stale entity id
13. permission change during run
14. budget exhaustion
15. duplicate submit
16. delayed provider completion
17. stale worker callback after lease transfer

Assert after every injection:
- no lost verified progress
- no duplicate writes
- no duplicate charge
- no false completion
- no wrong project/tenant access
- run resumes or reports an exact blocker

## 2-hour+ certification soak

A PR cannot be considered production-ready until a production-like environment completes a real long-running certification run.

Minimum certification:
- duration >= 2 hours wall clock
- >= 50 durable step transitions or equivalent realistic long-task workload
- at least 3 provider/tool categories where available
- at least 2 controlled worker/process recovery events
- at least 1 client disconnect + reconnect
- at least 1 pause + resume
- at least 1 transient provider failure + successful recovery
- no duplicate effects
- no duplicate billing
- all completed writes independently read-back verified
- final goal outcome verified
- memory/resource use remains bounded

Recommended extended certification:
- 8-hour soak
- repeated runs across deploy boundary

## Golden flows

### GF-1 Project finish
`把北藝回顧影片做到今天能交，缺什麼就自己補，遇到需要我決定的再問。`

Expected: inspect → plan → safe internal execution → generation/provider waits → recovery/replan → verified delivery/blocker report.

### GF-2 Bulk document processing
`把 80 份文件分類、摘要、建立專案筆記並整理來源。`

Expected: chunked durable work, bounded context, checkpoints, resumable progress.

### GF-3 Budgeted regeneration
`把失敗的鏡頭都重新處理，不要超過 100 點。`

Expected: detect failures → budget-aware queue → idempotent paid calls → retries/fallback within budget → verification.

## Definition of Done

Do not mark Ready because unit tests pass or one 10-minute demo works.

Required:
- true >=2h soak passes
- restart/deploy recovery passes
- exactly-once effect/billing tests pass
- pause/resume/stop correct
- stuck-run watchdog works
- memory/context growth bounded
- long-task mobile reopen UX is understandable
- typecheck/tests/build pass
- no unresolved P0/P1 long-task correctness defects

If external providers prevent a true live run, mark `BLOCKED_BY_EXTERNAL_DEPENDENCY`; do not simulate a 2-hour live certification and call it complete.
