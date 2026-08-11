# Aios Agent Practical Autonomy v4

## Goal

Turn Agent Brain v3 into a practical autonomous work system that can finish long creative/project tasks with minimal babysitting.

Core loop:

`UNDERSTAND → PLAN → SELECT TOOLS → EXECUTE → VERIFY → RECOVER/REPLAN → CONTINUE → DELIVER`

Brain v3 already established typed goals, source truth, continuation, verification and false-completion guards. v4 focuses on durable execution, tool breadth, recovery, grounded project-file access, reusable skills, cost/risk control and bounded delegation.

## Product principles

1. Aios should finish work, not merely answer.
2. Safe internal work should proceed without unnecessary confirmation.
3. External, paid, destructive or high-impact actions require policy-driven confirmation.
4. Every write is verified by read-back before completion.
5. Retry/reconnect/restart must never duplicate billing or side effects.
6. Client state is context only; server ACL/policy remains authoritative.
7. Public trace shows verifiable work events, never private chain-of-thought.
8. Mock/unavailable providers must never pretend to be real.

## P0 — Single typed Tool Registry

Create one server-owned registry used by planning, execution, UI capability status and tests.

Each tool definition should include at least:

- `id`
- `label`
- `category`
- `access`: READ / WRITE / EXTERNAL
- input/output schemas
- required context slots
- risk level
- confirmation policy
- idempotency policy
- cost policy
- timeout/retry policy
- verification strategy
- evidence scope
- provider/runtime availability
- handler identity

Do not duplicate tool truth across frontend keywords, prompts and backend handlers.

## P0 — Durable Run / Task Ledger

Long-running work must survive:

- assistant panel close
- route changes
- browser reconnect
- process restart
- worker restart
- deploy/redeploy

Persist bounded run state and step state with:

- runId / parentRunId
- goalId
- plan revision
- current status
- step ids / dependency ids
- tool id
- idempotency key
- attempt count
- expected effect
- verified result refs
- cost reservation / actual cost
- timestamps / lease ownership
- recoverability metadata

On resume, never replay a step whose effect was already verified.

## P0 — Retry, recovery and replan

Implement bounded recovery policy:

1. retry the same tool only when idempotent/safe
2. refresh stale context when needed
3. switch provider/tool when registry policy allows
4. replan remaining steps
5. ask user only when blocked by missing information, confirmation, credentials or external dependency

Requirements:

- exponential/backoff or provider-aware retry
- no duplicate paid generation
- no duplicate writes
- clear `retrying`, `replanning`, `blocked`, `failed` events
- bounded attempts and circuit breaker

## P0 — Project file tools with citations

Add or consolidate tools such as:

- `list_project_files`
- `read_project_file`
- `search_project_files`

Requirements:

- use existing project/file/data/intelligence storage, never create a second file system
- ACL-first retrieval
- bounded text extraction / chunk retrieval
- source/citation metadata in tool results
- support PDF/Office/text/notes/linked resources through existing parsed/intelligence layers where available
- answers based on project files should expose citations/source cards
- exact file references can continue into subsequent steps

## P0 — Budget Guard + cost-aware routing

Support user constraints like:

`不要超過 100 點，用品質最好的可用模型完成`

The agent must:

- estimate/reserve cost before paid actions
- choose model/tool based on task quality requirements + budget + health
- never silently exceed explicit budget
- never use a paid fallback when policy/budget forbids it
- avoid double reservation/charge on retry or SSE reconnect
- expose concise user-facing cost/budget state

## P0 — Reusable Skills / Workflows

Create reusable typed skills built on the Tool Registry rather than prompt-only macros.

A skill should contain:

- id/name/version
- inputs
- required capabilities
- DAG/ordered steps
- confirmation checkpoints
- cost policy
- verification expectations
- resumability contract

Initial practical skills should include:

- `project_health_scan`
- `story_to_storyboard`
- `storyboard_asset_prep`
- `creator_delivery_check`
- `organize_recent_assets`
- `research_to_project_notes`

Skills must remain editable/composable without bypassing server authorization.

## P0 — Bounded multi-agent delegation

Allow one parent run to delegate independent sub-tasks, primarily read/research/analysis work.

Examples:

- research
- organize assets
- inspect storyboard gaps

Requirements:

- parent run owns authorization and final writes
- child runs have explicit scope and budget
- child results return typed evidence/result refs
- bounded concurrency
- cancellation propagates from parent
- one consolidated user-facing trace
- avoid spawning agents for trivial deterministic work

Writes should remain centrally authorized and verified unless an existing safe worker architecture already provides equivalent guarantees.

## P0 — STOP / PAUSE / RESUME

Semantics must be strict:

- close panel != stop
- route change != stop
- `pause` stops new work without losing state
- `resume` revalidates leases/context before continuing
- `stop` cancels active work and transitions terminally
- paid/provider calls already accepted by an external service must be tracked honestly even if local run stops

## P1 — Project Health / Gap Agent

Support requests like:

`幫我把北藝回顧影片做到今天能交`

Agent should inspect project state and identify practical gaps across:

- story/script
- storyboard
- characters/scenes/props
- source/reference files
- generation status
- missing assets
- delivery/export readiness
- tasks/owners/deadlines when available

Then build an executable plan and do safe internal work automatically, asking only for real blockers.

## P1 — Creator workflow recipes

Prioritize end-to-end creative work:

`story → structure → storyboard → references/assets → generation prep → generation → review → delivery`

Reuse existing project, storyboard, generation, intelligence, editing and export cores. Do not create a second workflow engine if existing Agent DAG/run infrastructure can be extended.

## P1 — Context compression / targeted retrieval

Long runs must not keep sending the entire project to an LLM.

Use:

- deterministic refs
- typed summaries
- targeted retrieval
- compressed run memory
- verified result refs
- project/file search on demand

The LLM should receive only the context needed for the current decision.

## P1 — Human handoff only when necessary

Agent should not ask the user for normal engineering/workflow choices it can safely infer.

Human interaction is appropriate for:

- missing critical intent/target
- external login/OTP
- high-risk/paid/irreversible confirmation
- genuinely ambiguous creative direction
- external dependency unavailable

## P1 — Provider health and circuit breakers

Add or consolidate provider health-aware routing:

- timeout/error rate
- temporary disable/circuit open
- fallback only when policy permits
- clear provider-unavailable state
- never silently downgrade into a materially different paid/quality behavior

## P2 — Real Browser provider path

Computer Runtime remains server authoritative.

If a real provider is configured, wire through the existing provider abstraction and human takeover controls.

If no real provider/credential exists:

- capability reports unavailable/blocked
- mock provider stays test-only
- no fake browse/open/search/complete claim

## Required public execution events

At minimum support clean user-facing events for:

- `plan.created`
- `step.started`
- `tool.started`
- `tool.completed`
- `tool.failed`
- `verification.started`
- `verification.completed`
- `retrying`
- `replanning`
- `waiting.user_input`
- `waiting.permission`
- `paused`
- `resumed`
- `agent.completed`
- `agent.failed`
- `agent.stopped`

No private chain-of-thought.

## Golden flows

### GF-1 — Finish a real project

User: `幫我把北藝回顧影片做到今天能交`

Expected:

1. resolve project
2. run project health scan
3. detect missing deliverables
4. build executable plan
5. execute safe internal steps
6. delegate independent read-only analysis when useful
7. surface only true blockers
8. verify final deliverables/readiness
9. deliver concise result + remaining blockers

### GF-2 — Files to storyboard

User: `把這些文件整理成分鏡，放進目前專案`

Expected:

1. resolve recent/project file refs
2. list/read/search project files with citations
3. create storyboard structure
4. write through existing storyboard core
5. read-back verify
6. preserve source citations/evidence

### GF-3 — Budget-aware quality

User: `不要超過 100 點，用品質最好的可用模型完成`

Expected:

1. persist budget constraint in goal/run
2. estimate/select models/tools within budget
3. reserve cost before paid work
4. no hidden paid fallback
5. no duplicate charges on retry/reconnect
6. final actual cost/evidence

### GF-4 — Provider failure

Expected:

1. tool/provider fails
2. safe retry if idempotent
3. alternative provider/tool if allowed
4. replan if needed
5. never duplicate paid generation/write
6. honest failure if exhausted

### GF-5 — Crash/redeploy recovery

Expected:

1. run has completed and in-flight steps
2. process restarts
3. ledger restores state
4. verified effects are not replayed
5. unverified/in-flight steps recover per policy
6. run continues or reports exact blocker

### GF-6 — Parallel useful work

User: `把研究、整理素材、檢查分鏡同時做`

Expected:

1. detect independent sub-tasks
2. bounded child delegation
3. parallel read-only execution
4. aggregate typed evidence
5. parent performs/authorizes writes
6. one coherent result

## Regression / safety tests

Must include tests for:

- Tool Registry schema/availability/policy
- idempotency keys
- retry does not duplicate side effects
- retry does not double bill
- reconnect/SSE fallback does not duplicate execution
- persisted run recovery
- stop/pause/resume state machine
- project file ACL
- file citation/result metadata
- budget hard cap
- provider circuit breaker/fallback policy
- parent/child cancellation and budget scope
- child result aggregation
- no fake browser completion
- no completion before read-back verification

## Definition of Done

- production source code, not temporary patch scripts
- no duplicate orchestration truth
- no new parallel project/asset/file data model
- typecheck passes
- related server/client tests pass
- build passes
- golden flows have automated coverage where practical
- self-review for ACL, billing, retries, race conditions and stale runs
- PR remains Draft until acceptance criteria pass
- external credential/provider gaps reported as `BLOCKED_BY_EXTERNAL_DEPENDENCY`
