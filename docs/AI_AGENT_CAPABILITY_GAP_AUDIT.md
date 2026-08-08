# Aios Agent Capability Gap Audit

> Audit baseline: branch `agent/assistant-agent-execution-rebuild`, commit `f117896` (the merged Assistant / Agent UX rebuild plus its capability-gap implementation). This document treats that work and the current unpushed worktree as the current implementation. No legacy reset or replacement architecture is proposed.

## Executive finding

Aios already has most of the individual building blocks required by the product loop: authenticated page context, a read-only MCP catalog, service/command guarded writes, durable AgentRun/AgentEvent records, approvals and human tasks, SSE status delivery, project knowledge, Data Hub, generation history, and an Agent HUD. The main defect is not an absence of data or tools. It is that the Assistant does not consistently route one question across those resources, retain typed failure outcomes, verify writes by reading them back, or resume a failed durable plan from the minimum remaining step.

The implementation direction is therefore additive:

`Page Context -> Capability Router -> Resource Resolver -> existing MCP/Core services -> evidence -> answer/action -> read-back verification -> durable event/memory`

No `AssistantV2`, `AgentRunnerV2`, `MCP2`, `MemoryV2`, or `DataHubV2` is required.

## Capability matrix

Legend: `Y` complete, `P` partial, `N` absent, `—` not applicable. Reliability is the audit classification, not a claim that every path has production acceptance coverage.

| Capability | Exists? | Read? | Write? | Stream? | Resume? | Undo? | ACL? | Test? | Real UI? | Reliability |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| Project | Y | Y | Y | P | P | P | Y | Y | Y | PARTIAL |
| Story | Y | P | P | P | P | N | Y | P | Y | PARTIAL |
| Script | Y | Y | Y | P | P | P | Y | Y | Y | PARTIAL |
| Scene | Y | Y | Y | Y | P | P | Y | Y | Y | PARTIAL |
| Shot | Y | Y | Y | Y | P | P | Y | Y | Y | PARTIAL |
| Asset | Y | Y | Y | P | P | P | Y | Y | Y | PARTIAL |
| Generation | Y | Y | Y | Y | P | N | Y | Y | Y | PARTIAL |
| Knowledge | Y | Y | Y | P | — | P | Y | Y | Y | PARTIAL |
| Database | Y | Y | Y | P | — | P | Y | Y | Y | PARTIAL |
| File | Y | Y | Y | P | — | P | Y | P | Y | PARTIAL |
| Note | Y | Y | Y | P | — | Y | Y | Y | Y | PARTIAL |
| Task | Y | Y | Y | Y | Y | P | Y | Y | Y | PARTIAL |
| Schedule | Y | Y | Y | P | — | P | Y | Y | Y | PARTIAL |
| Member | Y | Y | P | P | — | N | Y | P | Y | PARTIAL |
| Collaboration | Y | Y | Y | Y | Y | P | Y | Y | Y | PARTIAL |
| Message | Y | Y | Y | P | — | N | Y | P | Y | PARTIAL |
| Approval | Y | Y | Y | Y | Y | N | Y | Y | Y | COMPLETE |
| AgentRun | Y | Y | Y | Y | P | P | Y | Y | Y | PARTIAL |
| Group Campaign | Y | Y | Y | P | P | P | Y | P | Y | PARTIAL |
| Model Catalog | Y | Y | P | — | — | — | Y | Y | Y | COMPLETE |
| External Source | Y | P | P | P | P | P | Y | P | Y | UNRELIABLE |

### Classification notes

- `COMPLETE`: Approval and Model Catalog have a coherent read/write-or-selection path, policy gates, UI, and focused tests.
- `PARTIAL`: most product entities are fully usable in their own UI, but Assistant direct-action coverage, source routing, read-back verification, undo, or resume coverage is incomplete.
- `MISSING`: no whole product domain is missing. Specific missing links are listed below.
- `DUPLICATED`: assistant lookup logic is duplicated between project and global/team context builders; regex/tool-loop duplication has already begun converging in `assistantCore`.
- `UNRELIABLE`: connected external sources exist, but connection availability, per-source query capability, timeout/auth/error semantics, and fallback are not uniformly surfaced to the Assistant.

## End-to-end loop audit

| Loop stage | Existing implementation | Gap before this audit | Target |
|---|---|---|---|
| SEE | authenticated project/page/selection context; Project Intelligence | project Assistant did not receive conversation/page context | pass bounded history and sanitized page context |
| UNDERSTAND | deterministic ASK/ACT/PLAN/WATCH classifier; LLM tool loop | compound action phrasing could take ACT fast path | route genuinely multi-step requests to PLAN |
| FIND | MCP read catalog; Data Hub; knowledge injection; project intelligence | no unified source plan or typed per-source outcome | Resource Resolver with parallel reads and fallback evidence |
| REASON | project intelligence and team context aggregate several sources | aggregation was endpoint-specific and provenance incomplete | compact multi-source evidence block with used sources |
| PLAN | durable AgentRun plan and approval flow | retry of failed run can re-plan rather than resume remainder | minimum-step resume semantics |
| ACT | command/core guarded actions; direct safe writes; confirmations | UI-to-Agent coverage is incomplete | capability/action coverage matrix and focused bridges |
| OBSERVE | SSE, AgentEvent, AiTrace, HUD | retrieval/tool health not normalized | outcome, duration, fallback, verification trace fields |
| RECOVER | transient retry, idempotency/effect IDs, human gate wake-up | manual failed-run resume remains partial | resume completed plan without repeating costful/destructive effects |
| VERIFY | command success and some runner reconciliation | direct Assistant writes generally trusted command success | read-back verification and explicit unverified result |
| REMEMBER | chat records, knowledge, notes, decisions/activity/recent action | no thin unified projection; confirmed decisions are not promoted consistently | working/project/decision memory projection over existing stores |

## Current retrieval reality

There is no production vector index to assume. This iteration adds bounded hybrid ranking (keyword + metadata) and an optional semantic adapter. Until an adapter is configured, provenance explicitly reports `semanticApplied=false`; the UI never calls keyword-only evidence semantic.

| Surface | Current technique | Semantic/vector? | Audit result |
|---|---|---:|---|
| Data Hub tables | in-memory keyword match on name/description plus metadata filters | N | PARTIAL |
| Data Hub documents/files | SQL `ILIKE` on filename/name plus binding metadata | N | PARTIAL |
| Knowledge | SQL `ILIKE` on title/summary/content depending endpoint | N | PARTIAL |
| Assets | SQL `ILIKE` on title plus kind/project metadata | N | PARTIAL |
| Project | exact IDs, ACL-scoped lists, project intelligence summaries | N | PARTIAL |
| Database rows | JSONB text `ILIKE`, bounded result sets | N | PARTIAL |

The repository roadmap also describes vector RAG as future work. The safe progressive design is hybrid orchestration now—keyword + metadata + structured entity signals—with an optional semantic adapter later. The resolver must record the actual retrieval mode and must never label keyword results as semantic.

## Resource Resolver source map

| User evidence need | Existing source/tool | Priority/fallback |
|---|---|---|
| current state / blockers | `get_project_status`, tasks, schedule, scenes, generations, AgentRuns | query independently in parallel; answer from surviving evidence |
| prior discussion / decisions | knowledge, notes | knowledge -> notes; EMPTY is valid, not a failure |
| missing storyboard material | scenes, assets, generations | correlate identifiers and missing bindings |
| ownership / unfinished work | tasks, members, collaboration/approvals | avoid duplicate work when an owner or active run exists |
| project data | readable databases, database query, Data Hub bindings/files | enforce existing agentAccess/ACL; never direct-write DB |
| connected sources | integration/Data Hub source metadata and permitted import/search tools | only claim readable evidence when a source query succeeds |
| web | only when product policy and an available audited tool allow it | external/open-world, never silent fallback for a write/cost |

Every read result is classified as one of: `OK`, `EMPTY`, `TIMEOUT`, `AUTH_DENIED`, `NOT_AVAILABLE`, or `TOOL_ERROR`. Independent reads run in parallel. Safe transient reads may retry once; writes are not part of retrieval fallback.

## ASK / ACT / PLAN / WATCH routing

| Intent | Route | Planner? | Mutation rule |
|---|---|---:|---|
| ASK | page context + parallel Resource Resolver + short answer | N | none |
| ACT | exact capability + existing command/core + read-back verify | N for one operation | only explicit safe write can auto-run; costful/external/destructive confirms |
| PLAN | AgentRun with durable steps/events/approval | Y | execute only approved steps, preserving idempotency |
| WATCH | existing watch/activity/attention architecture | N for registration | persistent watch required; a one-off digest is not described as monitoring |

## Direct action coverage audit

This table distinguishes an existing UI/service capability from a complete Assistant path. `Propose` means the Assistant can suggest the operation but cannot safely execute it without the existing confirmation/AgentRun flow.

| User intent | Existing service/command | MCP tool | Agent step | Assistant action | Status |
|---|---|---|---|---|---|
| create an unassigned task | task core/command | task tools exist | human task/create task | direct + undo | COMPLETE |
| create a note | note core/command | note tools exist | note step | direct + undo | COMPLETE |
| split a script into shots | director + scene write core | scene tools exist | split_script | direct + undo | PARTIAL: add read-back verify |
| create/update/reorder scenes | scene command/core | add/update/reorder scene | supported in AgentRunner | propose/confirm is uneven | PARTIAL |
| bind asset to a scene | scene visual command/core | set scene visual | supported by generation flow | no general direct bridge | MISSING |
| create/update/sort/assign tasks | task command/core | task reads; human task write | human gate | only narrow unassigned-create direct | PARTIAL |
| create schedule item | schedule core, possible calendar sync | schedule reads | planned/human | confirmation required | PARTIAL |
| write database row | database command/core | database reads | planned | proposal only | PARTIAL |
| generate/retry media | generation command/provider | generation tools | generation step | confirmation/cost preview | COMPLETE for guarded path |
| approve/reject work | approval core | agent approval tools | approval event | explicit UI | COMPLETE |
| send collaboration message | DM service | DM tool | collaboration step | external confirmation | PARTIAL |
| create/update knowledge | knowledge core | knowledge tools | available | no broad direct bridge | PARTIAL |

## Recovery and retry audit

Existing safeguards to preserve:

- durable run goal, plan, completed/failed step state, tool/effect results, errors, and AgentEvents;
- transient retry for safe/idempotent reads and writes;
- stable effect/scene identifiers for crash reconciliation;
- at-most-once handling for ambiguous costful provider calls;
- approval and human-task waits that wake the AgentRun when settled;
- SSE disconnect does not delete durable state.

Required policy:

| Operation class | Automatic retry |
|---|---|
| READ | safe bounded retry on transient error |
| IDEMPOTENT WRITE | only with existing idempotency/effect key |
| COSTFUL | never silently repeat an ambiguous provider call |
| DESTRUCTIVE | never automatic |

Current remaining gap: the user-facing retry command can build a new plan from the same goal. A true resume must preserve completed steps and continue only the failed/necessary remainder.

## Memory audit

Do not create another memory database. Build a thin projection over current records:

- Working Memory: bounded current conversation, page/entity/selection, and recentAction.
- Project Memory: project knowledge, notes, storyboard/script, data bindings, activity, and relevant AgentEvents.
- Decision Memory: explicitly confirmed decisions stored as a typed knowledge/note record and linked to the project.

Conversation text alone is not a durable decision. Promotion must be explicit or based on a confirmed action such as “角色之後都穿米白外套”.

## Attention, cost, model, and provenance

- Attention must be actionable: approaching/overdue deadlines, failed generation, missing scene asset, pending approval, blocked run, or incomplete storyboard. Deduplicate and rate-limit it; do not convert every activity into a notification.
- Reads and internal analysis are `FREE`; provider calls are `LOW_COST` or `COSTFUL` according to the live model catalog. Large count/provider/cost must be shown before execution.
- Model routing should request the smallest fit: fast classification, reasoning for complex plans, vision for image evidence, generation models for media, long-context only when the evidence budget requires it. Existing live Model Catalog remains the source of truth.
- Important answers retain `usedSources`; the default UI shows “參考 N 個來源” and expands to source/outcome/duration/fallback details.

## Test and acceptance matrix

| Scenario | Automated target | Real UI target |
|---|---:|---:|
| primary source found | required | required |
| primary EMPTY | required | required |
| primary TIMEOUT, fallback found | required | required |
| all sources absent | required | required |
| ACL denied | required | required |
| tool error | required | details only |
| LLM timeout | existing + regression | required |
| SSE disconnect | existing + regression | required |
| resume | required | required |
| one-step ACT | required | required |
| multi-step PLAN | required | required |
| write then verify | required | required |
| costful confirmation | existing + regression | required |
| page selection/project switch | existing + regression | required |
| human gate then resume | existing + regression | required |
| parallel retrieval | required with elapsed-time assertion | details only |
| source provenance | required | required |
| no hallucinated success | required | required |

Real UI acceptance is recorded only after exercising the authenticated application. Automated tests or source inspection do not count as a successful real UI run.

## Delivery ledger

This section is updated as implementation lands.

### Existing before this audit

- Deterministic ASK/ACT/PLAN/WATCH classification and Agent UX cards.
- Read-only MCP boundary with ACL enforced by existing services.
- Project Intelligence and team/global context aggregation.
- Durable AgentRun/AgentEvent, approval, human-task wake-up, transient retry, idempotency, and at-most-once cost safeguards.
- AiTrace and SSE progress/latency surfaces.
- Direct safe note/task/script-split actions with Undo; paid/external/destructive confirmation.

### Gaps selected for this iteration

- Unified Resource Resolver, typed outcomes, parallel fallback, provenance and timing.
- Project Assistant history/page context and reduced serial context latency.
- Compound request routing to PLAN.
- Consistent read-back verification and explicit unverified-success language.
- Minimum-step failed-run resume.
- Capability registry projection, retrieval health/observability, and a thin memory/attention architecture where existing stores support it.

### Verification status

Implemented and verified in this iteration:

- Resource Resolver routes by intent/page, performs independent MCP reads in parallel, retries a safe transient read once, and retains `OK / EMPTY / TIMEOUT / AUTH_DENIED / NOT_AVAILABLE / TOOL_ERROR` per source.
- Resolver coverage now includes Project Status, Knowledge, Decision Log, Notes, Tasks, Schedule, Storyboard, Assets, Generation History, AgentRuns, persistent Watches, Collaboration, and project-bound Databases. One unavailable source does not kill surviving evidence.
- Project Assistant sends bounded conversation history and sanitized page/entity/selection context through both SSE and tRPC fallback.
- Existing scene/intelligence/knowledge/database context preparation now starts together; optional intelligence, knowledge, and database-list failures degrade instead of killing the answer.
- Source provenance is merged into the existing expandable UI. The first layer says `參考 N 個來源`; details show retrieval mode, whether semantic ranking really ran, duration, retry, empty, timeout, ACL, unavailable, and tool-error outcomes.
- Compound action requests route to PLAN while one bounded write remains on the ACT fast path.
- Site actions and direct script splitting re-read the created entity/entities. The UI distinguishes verified completion from `操作已送出，但驗證未通過`.
- Failed AgentRuns can resume the existing durable plan from unfinished steps. Completed effects remain intact; ambiguous in-flight split-provider calls are not replayed.
- A bounded capability-registry projection filters the existing MCP catalog by intent, page, entity and write permission, and is injected into the Project Assistant prompt instead of exposing the complete catalog.
- Decision Memory uses the existing `decisions` store: Assistant/MCP can list or save a confirmed project decision, verify it by reading it back, and undo by revoking it. No second memory database was created.
- Persistent WATCH uses the existing Agent/Notification architecture plus `assistant_watches`: seven actionable watch kinds are evaluated from Tasks, Generation, Storyboard, Approvals and AgentRuns; identical evidence is rate-limited within a six-hour window.
- Resource health records process-local read/empty/failure/timeout/latency signals. Unhealthy routed sources are retained in AiTrace so future routing can prefer a healthy fallback without inventing an answer.
- Hybrid retrieval is a progressive adapter: keyword + metadata ranking is live for Knowledge, Notes, Assets and Databases; a bounded semantic adapter contract is tested but no vector infrastructure or false semantic claim was introduced.
- The previous CI safe-path failure is fixed: repeatedly encoded protocol-relative paths, encoded backslashes, control characters and malformed encodings are rejected before client navigation.
- Migration `0056_assistant_watches` is idempotent, registered in the migration revision ledger, and covered by the legacy-adoption guard.

Automated evidence:

- Focused Agent/Resolver/Memory/Router server+shared suite: 45/45 passed.
- Migration ledger and WATCH suite: 27/27 passed.
- Focused affected Assistant client suite: 44/44 passed, including source disclosure, direct decision/watch action cards, and encoded safe-path rejection.
- Full server run after the migration fix: 2,344 passed and 98 skipped; one unrelated pre-existing Windows path-separator assertion failed (`userAvatar.test.ts`). The storage persistence suite's setup hook also timed out on this Windows workspace and therefore skipped its 21 tests; it does not import any changed file.
- Full client run before updating the new provenance label: 1,657 passed with 9 failures. The only touched failure (`AskSources`) was fixed and then passed in the 44/44 focused run. The remaining eight failures are in pre-existing `StoryboardScript`, FAB CSS-contract and Planner source-order tests; none imports a file changed by this iteration.
- TypeScript `tsc --noEmit`: passed.
- Production build: passed (Vite 618 modules plus bundled server).
- Import-boundary, UI-primitive and hooks-after-return checks: passed.
- GitHub CI after the MCP catalog correction: both build, test, migration, container, lint-gates, and E2E jobs passed. The two E2E jobs completed in 6m41s and 6m45s with all 77 registered MCP tools represented in the exact catalog assertion.
- Agent planner canary could not run because this workspace has no `FAL_KEY`; no provider result is claimed.

Latency evidence:

- Before: project context preparation awaited scenes/intelligence, then knowledge, then readable database discovery. Its critical path was `max(scene, intelligence) + knowledge + database` before the model could start.
- After: all five preparations, including routed retrieval, start in one `Promise.all`; the critical path is their maximum. The resolver parallelism test starts four independent 100 ms readers together (`peak=4`) and completes within the test's <200 ms bound, versus ~400 ms if serialized.
- Every routed source now records duration/attempts/outcome, and the process-local health tracker records average latency, zero results, timeouts and consecutive failures.
- Production p50/p95 before/after was not measured in this workspace and is not claimed. Per-source and resolver duration is now retained in AiTrace/UI so deployment telemetry can establish it.

Real UI acceptance result:

- The production build was served locally and opened in Chrome. The landing page rendered its product loop, safety/cost language, navigation, and accessible headings/links; `/login` rendered labeled Email/Password fields, password visibility control, sign-in button, invite notice and install controls.
- The PR preview deployed successfully, but it redirects to Vercel team authentication. The available production project route rendered the Aios offline screen. Aios credentials supplied for acceptance were not sent to Vercel, persisted, or committed.
- The ten authenticated Assistant scenarios were **not executed** because neither reachable environment exposed an Aios login/project session. Therefore this audit does not claim real authenticated UI acceptance or a live provider call.
- Focused component/UI automation covers project switching, SSE behavior, direct action cards, source disclosure, and Assistant interaction, but it is not counted as the requested authenticated real-world run.

Still incomplete / deliberately not overstated:

- Authenticated real UI acceptance, deployed p50/p95 latency comparison, and a live resource-timeout drill still require a reachable database-backed Aios environment; the supplied Aios identity is available for that run once the preview protection or production outage is resolved.
- No vector/embedding infrastructure was introduced. The semantic adapter contract exists, but production evidence remains keyword + metadata until a real adapter is configured.
- Global/team Assistant keeps its narrower hand-authored action schema because those actions are not the same as the Project MCP catalog; the Project Assistant is the migrated registry-backed surface.
- Existing unrelated red tests remain visible above; this change does not silently rewrite those product areas or their tests.
