# AIOS Latest Defect Convergence — 2026-08-12

## Purpose

This branch is the **single implementation sink** for the newest defects discovered by the 2026-08-12 multi-role testing, scenario testing, E2E, UX audits, production smoke checks, and follow-up regressions.

The goal is not to produce another audit-only document. The goal is to reconcile the latest evidence against **CURRENT HEAD**, implement every still-valid defect at root cause, add regression coverage, retest in production-like conditions, and keep iterating until the remaining product behavior is trustworthy.

Primary loop:

`RECONCILE → REPRODUCE → FIX ROOT CAUSE → REGRESSION TEST → LIVE RETEST → FRESH-EYE → SOAK/CHAOS → REPEAT`

## Critical warning: older repair maps are stale

`docs/testing/CODE_FIX.md` from PR #688 is useful as historical evidence, but its issue-number mapping no longer consistently matches the actual GitHub issue bodies.

Examples observed while creating this convergence branch:

- actual #665 = blocked SOURCE_PICKER has no clickable alternative path;
- actual #675 = structured response format repair only gets one repair attempt;
- actual #674 = explicit-project partial-match ambiguity;
- the #688 guide assigns some of those numbers to different problems.

Therefore **do not implement by issue number from CODE_FIX.md alone**.

Authority order for this PR:

1. current source code on the PR base/head;
2. actual GitHub issue title/body and latest comments;
3. latest merged/follow-up PR diff and regression tests;
4. live/staging reproduction evidence;
5. older audit documents only as historical hints.

Never overwrite a newer fix with an older suggested patch.

---

# 1. Required triage states

Every defect or test finding must be classified before implementation as one of:

- `PROVEN_OPEN` — reproducible on current HEAD or directly proven by current source;
- `FIX_PRESENT_NEEDS_RETEST` — a later PR appears to fix it, but current-head regression/live proof is still required;
- `SUPERSEDED` — newer implementation replaces the old failure path;
- `DOCS_ONLY_NOT_IMPLEMENTED` — specification exists, production runtime does not;
- `NEEDS_LIVE_REPRO` — code inspection is insufficient;
- `BLOCKED_BY_EXTERNAL_DEPENDENCY` — real external credential/provider is required;
- `FALSE_POSITIVE_CLOSE_WITH_EVIDENCE` — current code/test proves the report is not a defect;
- `FIXED_AND_VERIFIED` — root fix + regression + required retest all pass.

Do not close an issue merely because a similarly named PR was merged.

---

# 2. Current defect reconciliation: actual issues #660–#680

## P0 / high user-impact

### #660 — simple read query enters AGENT mode

Actual issue: `幫我列出我目前有哪些專案` can be treated as AGENT/DIRECT instead of ASK, increasing latency/cost and potentially widening action authority.

Audit together with #663. Do not fix this by endlessly growing one regex. Regex may remain a fast hint, but typed semantic resolution must be execution authority.

Required regression corpus:

- 幫我列出目前有哪些專案
- 顯示全部專案
- 有幾個專案
- 哪一個最舊
- 查看最近匯入的素材
- 幫我分析專案
- 幫我建立任務
- 幫我安排明天下午三點的會議

Read queries must remain read-only; action requests must remain executable.

### #661 — project list omitted visible project

Historical root cause later identified in PR #695: `PROJECT_LIMIT=15` truncated an older project in a 17-project group.

Classify `FIX_PRESENT_NEEDS_RETEST` if current source contains the #695 behavior.

Acceptance:

- assistant project count equals authoritative project list for the same ACL scope;
- all names are represented or truncation is explicitly surfaced;
- explicit project lookup works even beyond any context-list cap;
- no client-only project list is treated as authority.

### #662 — oldest project answer incorrect

Historically coupled to #661 because the actual oldest project was omitted from context.

Do not assume the sort field from stale docs. Determine product semantics from the current response contract (`createdAt` vs last activity/`updatedAt`) and make wording explicit.

Acceptance:

- authoritative complete candidate set;
- deterministic sort;
- test both `最早建立` and `最久沒更新` if the product supports both concepts;
- no answer based on a truncated context window.

### #663 — QUESTION_RE / Chinese intent coverage is systemically incomplete

Treat together with #660, but preserve the architectural invariant introduced by Agent Brain v3: regex is a hint, not final execution authority.

Required adversarial corpus includes:

- 列出 / 清單 / 顯示 / 查看 / 查詢 / 找出來
- 有幾個 / 有多少 / 總共
- 有誰 / 誰是
- 哪一個 / 哪個 / 哪些
- polite forms (`可以幫我看看…`)
- mixed Chinese/English (`list projects`, `查 Drive files`)
- typo/colloquial variants
- questions that contain action verbs but are still read-only
- actions phrased as questions (`可以幫我建立一個任務嗎？`)

The last case is important: a question mark must not turn a requested write into ASK.

### #664 — SOURCE_PICKER / interaction can become stale and poison continuation

Audit the typed interaction system from PR #658 and current persistence.

Required behavior:

- every interaction has durable identity and expiry;
- cancel clears or safely transitions the pending interaction;
- stale callbacks are rejected;
- opening/closing panel, route change, refresh, reconnect do not attach old selection to a newer goal;
- user has a visible cancel/exit path;
- expired interaction cannot leave an `activeGoal` that hijacks later project resolution;
- `waiting_user_input` is never `completed`.

Do not implement a blind client timeout that silently loses a valid server run. Expiration authority must be server-verifiable.

### #665 — blocked source has no clickable alternative workflow

Actual issue: when Google Photos or another source is unavailable, the UI can say “use Drive/local file” but offers no action surface.

Required interaction:

`BLOCKED source → honest reason + available alternatives as real buttons/cards → chosen alternative opens actual picker/intake → same goal resumes`

At minimum support, when available:

- Google Drive;
- local files;
- URL import;
- AIOS/project assets.

Do not render an enabled alternative if capability health says it is unavailable.

---

## P1 / medium systemic impact

### #666 — repeated retrieval in same conversation

Optimize only after correctness.

Do **not** trust a client cache as data authority. Reuse must be bounded, scoped, version/staleness-aware, and permission-safe.

Desired design:

- cache/reuse typed evidence refs or server-authoritative summaries;
- key by tenant/group/project/source/query shape/version as appropriate;
- invalidate on known writes or source-version change;
- allow targeted delta retrieval;
- never reuse evidence across groups/projects/users without explicit safe scope;
- measure saved tool calls and latency.

Acceptance: follow-up questions such as `哪個最舊？` can reuse already fetched complete project facts when still valid without re-running an identical expensive retrieval.

### #667 — capability certification / readiness semantics

Later PRs #684 and #696 changed certification and `/api/ready` behavior. Re-audit the resulting contract instead of simply restoring the old 503.

Separate concepts:

1. web/process readiness;
2. Agent capability readiness;
3. live certification state;
4. deployment identity confidence.

Requirements:

- `CERTIFIED` must never mean merely “registry entry exists”;
- incomplete/expired verification can be a process-level warning if desired, but the planner/UI must not call that capability certified;
- required `BROKEN/BLOCKED` capabilities must fail/degrade honestly;
- current certification state must expose evidence timestamp and blocker;
- no lowering of required counts just to make readiness green;
- production smoke should use real handlers and authoritative verification.

### #668 — Computer Runtime endpoint regression / routing truth

Historical reports show 404/401 drift. Current source must prove router registration and deployed route behavior.

Acceptance:

- route contract test;
- unauthenticated request returns the expected auth response, not missing route;
- capability health reflects provider reality;
- mock provider never upgrades to real browsing certification;
- if no real provider is configured, status is `BLOCKED_BY_EXTERNAL_DEPENDENCY`, not success.

### #669 — work trace says the same thing for unrelated queries

PR #693 appears to introduce semantic round titles. Re-test current HEAD.

Public trace must describe observable work, not private chain-of-thought and not fake generic steps.

Different goals should produce meaningfully different observable labels while still being derived from real execution events.

### #670 — `extractJsonObject` greedy extraction

Do not replace the greedy regex with a naive non-greedy regex; nested JSON would then break.

Implement a robust bounded extractor/parser strategy such as:

- strip supported code fences;
- scan for first JSON object using string/escape-aware brace balancing;
- parse the first complete object;
- optionally continue to next candidate only if the first is invalid;
- enforce output schema after parse.

Regression cases:

- nested objects;
- arrays inside object;
- braces inside quoted strings;
- escaped quotes;
- two consecutive JSON objects;
- prose before/after JSON;
- malformed/truncated JSON;
- maliciously huge output bounded by size/time limits.

### #671 — MAX_PLAN_STEPS is only a prompt suggestion

Hard-enforce server limits after parsing/normalization and before persistence/execution.

Also audit:

- maximum tool calls;
- maximum child-agent depth;
- maximum parallel children;
- maximum plan revisions;
- cost/budget bounds.

A model must never gain authority by ignoring prompt-only limits.

### #672 — billing-null refund concern

Conflicting evidence exists: the issue reports a possible free-call path while later security review claimed no vulnerability.

Do not assume either conclusion. Re-audit current code with tests.

Required invariants:

- reservation, actual provider usage, settlement and refund reconcile;
- missing usage metadata is explicitly represented and auditable;
- repeated planning failure cannot create unbounded free provider calls;
- retry/reconnect does not charge twice;
- user cancellation semantics are deterministic;
- anomalous/missing provider billing emits telemetry;
- no arbitrary “keep 10%” heuristic unless it matches the product billing policy and provider facts.

If current code is safe, close with executable test evidence.

### #673 — current page vs stale activeGoal project resolution

Expected default precedence for a new ambiguous read/action:

`explicit project mention > current page context > compatible activeGoal > recent result`

But continuation semantics matter: an explicit `繼續剛剛 B 專案那件事` may intentionally retain B even while user is viewing A.

Implement typed resolution, not a single unconditional reorder.

Tests:

- page A + stale goal B + `列出分鏡` → A;
- page A + goal B + `繼續剛才 B 的工作` → B;
- explicit C always beats both when authorized;
- unauthorized explicit target fails closed.

### #674 — exact project name loses to substring ambiguity

Actual issue: `D` vs `DDD`.

Resolution priority:

1. normalized exact match;
2. unique safe prefix match;
3. unique contains/fuzzy match;
4. otherwise structured clarification card.

Never “pick first” from ambiguous candidates.

### #675 — structured response repair only gets one chance

Do not create an unbounded LLM repair loop.

Recommended bounded ladder:

1. deterministic parser/extractor repair where safe;
2. one schema-preserving LLM repair;
3. one simplified-schema repair when useful;
4. honest plain-text fallback with no fabricated structured actions.

Track repair attempts/cost/latency and never replay side effects because response formatting failed.

---

## P2/P3 / UX and observability

### #676 — deployment SHA missing

Current deployment identity should expose enough immutable information to diagnose drift:

- git/build SHA when the platform can inject it;
- build timestamp/version;
- schema version;
- capability registry hash/version.

Do not make a fake SHA. If Zeabur cannot provide one automatically, wire supported build/deploy environment injection and report `unknown` honestly until configured.

### #677 — assistant lazy-load flash

PR #693 appears to add a skeleton. Verify mobile and desktop rendering, reduced motion, and no content jump.

### #678 — mobile bottom navigation feedback

PR #683 added test coverage, but it was described as a test-focused PR. Inspect actual CSS/production behavior.

Acceptance:

- current route clearly distinguishable;
- touch feedback;
- no hover-only dependency;
- 44px target;
- keyboard/screen-reader state remains correct.

### #679 — conversation LRU inefficiency

PR #681 appears to supersede this. Re-run the current regression and mark `FIXED_AND_VERIFIED`; do not rebuild a second cache unless needed for #666.

### #680 — MEMBER_REF_LIMIT silently hides members

Do more than append a warning.

Requirements:

- list responses disclose truncation/pagination when a compact context cap is used;
- explicit name lookup must be able to resolve an authorized member beyond the compact list cap;
- server re-validates user/group scope before mutation;
- “not in the first N” must not become “member does not exist”.

---

# 3. Later scenario-test findings that must be folded in

## PR #698 — Q13/Q16/Q18

Reconcile current HEAD with these later findings:

### Q13 scheduling

`幫我安排明天下午三點的會議`

Must resolve to the scheduling action path, not ordinary ASK, while preserving the required confirmation/risk policy before external/calendar-like side effect.

### Q16 recent imports

`最近匯入了哪些素材？`

Must be treated as an already-imported provenance/read request and must not unnecessarily ask “Drive/Photos/local?” when the user is asking about AIOS recent imports.

### Q18 asset-count source consistency

Keep source scopes explicit:

- `assets` / project material library;
- custom database rows;
- remote Drive/Photos;
- AIOS library/global/group data.

Never answer one source’s count using another source without labeling it.

---

# 4. Cross-cutting workstreams beyond #660–#680

## A. Long-running autonomous work — currently docs-only evidence

PR #659 is titled as a 2h+ durable runtime but its changed-file evidence was only the specification document. Treat the actual runtime as `DOCS_ONLY_NOT_IMPLEMENTED` until current production code proves otherwise.

Implement/reuse the existing Agent Brain / Practical Autonomy infrastructure, not a second workflow engine.

Minimum runtime requirements:

- durable run/step state;
- queue/DAG execution independent of one browser/SSE connection;
- worker lease + heartbeat + stale-worker fencing;
- durable checkpoints;
- idempotency keys and verified receipts;
- provider-job identity/polling;
- pause/resume/stop;
- restart/deploy recovery;
- stuck-run reconciliation;
- bounded context/memory;
- hard budget guard.

Certification requires a **real >=2-hour wall-clock production-like soak**, not mocked elapsed time.

During the soak inject client disconnect, refresh, route change, worker/process restart, provider 429/5xx, retry, duplicate submit and pause/resume.

Assert zero duplicate write, zero duplicate billing, zero lost verified progress, zero false completion and zero wrong-tenant mutation.

## B. SPA / deployment reliability

PR #689 reported periods where `/api/health` was 200 while SPA pages intermittently returned 502, blocking five test streams.

Reproduce current deployment behavior and harden observability/smoke checks:

- root document;
- JS/CSS asset fetch;
- authenticated app boot;
- API health/readiness;
- static asset/cache behavior;
- deployment identity;
- restart/redeploy behavior.

A healthy API alone is not sufficient product readiness.

## C. Provider routing / cost discipline

Re-audit #653/#654 NIM→Fal degradation behavior against product cost policy.

Invariants:

- explicit free/no-paid-fallback mode never silently incurs paid provider cost;
- user hard point budget is never exceeded by fallback;
- direct user-selected tier is respected;
- provider health/circuit-breaker affects routing;
- timeout fallback does not replay an already accepted provider job;
- fallback provider/cost is visible in receipt/telemetry.

## D. Public Agent Fuel

Re-audit #692/#697/#699 two-layer public/group material strategy.

Verify:

- global source of truth vs group copy/sync semantics;
- idempotent upsert;
- no user project storage usage;
- no cross-group leakage;
- no sensitive content import;
- duplicate result suppression;
- evidence/provenance shown to Agent/user;
- `query_database` can actually retrieve expected group-readable entries;
- sync drift is detectable rather than silently serving stale knowledge.

## E. Computer Runtime / human takeover

Audit current code instead of blindly merging stale #636.

Prove:

- real route registration;
- provider availability truth;
- human takeover lease/fencing if currently wired;
- stale lease recovery;
- stop cancels/revokes appropriately;
- persisted auth remains opt-in/encrypted and never exposes raw cookies/tokens to LLM/client;
- real browser certification only with a real provider.

## F. Security and Agent authority

Regression suite must include:

- tenant/group/project IDOR;
- client-supplied ID revalidation;
- prompt/tool injection from imported files/URLs;
- SSRF and redirect-to-private targets;
- memory/source poisoning;
- stale interaction callback replay;
- child-agent privilege escalation;
- destructive/external/payment confirmation policy;
- secret leakage in logs/events/client state.

---

# 5. Implementation waves

## Wave 0 — Current-HEAD reconciliation

Before changing production code:

1. fetch latest base and inspect the actual diff/history after #688;
2. read the actual issue bodies #660–#680;
3. inspect current code for repair PRs #681, #684, #686, #693, #695, #696, #698, #699 and any newer work;
4. mark each item with one triage state;
5. record exact reproduction before fixing `PROVEN_OPEN` items.

Do not reopen a fixed path simply because an older document says it is broken.

## Wave 1 — P0 root-cause fixes

Prioritize semantic/read-vs-action authority, complete project/source truth, interaction expiry/cancel/replay, and blocked-source alternative actions.

## Wave 2 — P1 correctness/reliability

Handle evidence reuse, readiness/certification truth, Computer Runtime route truth, parser robustness, hard plan bounds, billing reconciliation, project-context precedence and format-repair reliability.

## Wave 3 — P2/P3 usability/observability

Deployment identity, loading/navigation UX, member truncation, and verified superseded issues.

## Wave 4 — cross-cutting runtime hardening

Long-running implementation, provider policy, Public Agent Fuel consistency, SPA 502/readiness, Computer Runtime/human takeover, security regressions.

## Wave 5 — fresh-eye and soak

Run natural-language scenario suites, mobile/desktop E2E, fault injection, DB tests and true long soak. Fix new P0/P1 findings in this same PR and repeat.

---

# 6. Required natural-language regression corpus

At minimum include the 31-scenario suite if available, plus:

- 幫我列出我目前有哪些專案
- 哪一個最舊？
- 哪一個最久沒更新？
- 有多少素材？
- 最近匯入了哪些素材？
- 不是 Drive，是 Photos
- Google Photos 不能用的話改用 Drive
- 從手機選三張
- 把剛剛那些放第三鏡
- 第二個
- 繼續
- 先不要做這步
- 改成另一個專案
- 幫我安排明天下午三點的會議
- 幫我建立任務，但不要超過 100 點
- 幫我研究、整理素材、檢查分鏡同時做
- 幫我把整個專案做到可以交，失敗就自己換安全方法

Include typo, colloquial Traditional Chinese, mixed Chinese/English, short replies, correction, negation, conditional and compound requests.

---

# 7. Verification requirements per P0/P1

Every fixed P0/P1 must pass:

1. exact original reproduction;
2. semantic paraphrase;
3. adjacent edge case;
4. route/reload/reconnect/retry variant when relevant;
5. full relevant regression suite.

For idempotency/billing/provider/recovery issues, repeat the same effect multiple times and reconcile authoritative DB/receipt/billing state.

No “unit test passed therefore live fixed” shortcut.

---

# 8. Product-level Golden Flows

## GF-1 — project truth

`幫我列出所有專案，再告訴我哪個最久沒更新。`

Must use a complete authorized candidate set and distinguish list/count/sort semantics.

## GF-2 — source handoff

`從 Drive 加五張圖到目前專案，整理後放第三鏡。`

Expected:

`resolve project → Drive picker → persist/import → verified refs → classify/organize → resolve shot 3 → bind → read-back → truthful completion`

## GF-3 — blocked source recovery

`從 Google Photos 加照片。`

If unavailable, render honest blocker plus real Drive/local/URL alternatives; choosing one resumes the same goal.

## GF-4 — schedule

`幫我安排明天下午三點的會議。`

Must classify as action, show required confirmation, and only claim success after authoritative persistence/read-back.

## GF-5 — bounded paid work

`不要超過 100 點，用品質最好的可用模型完成。`

Hard budget must survive provider fallback/retry.

## GF-6 — 2h+ autonomous run

A multi-step real project task must remain correct for >=2 hours through disconnects/restarts/retries with no duplicate effects/billing.

---

# 9. Readiness gates

This PR must remain Draft until all of the following are true or explicitly documented as external blockers:

- no known open P0;
- no known open P1 on core Agent flows;
- no known false-completion path;
- no known duplicate write or duplicate billing path;
- no known cross-tenant/IDOR path;
- every #660–#680 issue has a current-head disposition with evidence;
- later scenario findings (including Q13/Q16/Q18) are revalidated;
- relevant internal capabilities have authoritative staging/live verification;
- external capabilities are honestly certified/degraded/blocked;
- SPA smoke passes, not only API health;
- mobile core flow at ~390px is usable with no manual tool hunt where a structured handoff exists;
- 31-scenario suite rerun (or equivalent newer superseding suite) passes required cases;
- two consecutive fresh-eye rounds discover no new P0/P1;
- typecheck passes;
- server/client tests pass;
- build passes;
- migration/schema/integrity gates pass;
- security regression passes;
- >=2h true wall-clock long-run certification passes after long-task runtime is actually implemented.

If a real provider credential is unavailable, mark only that capability `BLOCKED_BY_EXTERNAL_DEPENDENCY`; continue all independent work.

---

# 10. Delivery rules

- Work only on this PR branch for this convergence task.
- Do not open another implementation PR.
- Do not auto-merge.
- Do not rewrite or duplicate Project/Asset/Storyboard/Billing/Agent systems; reuse existing cores.
- Do not delete failing tests to make CI green.
- Do not weaken readiness/security gates solely to get a green status.
- Do not mark mock success as live success.
- Do not expose private model chain-of-thought; public trace is observable execution only.
- Do not put credentials/secrets in source, prompts, PR comments or logs.
- Commit/push incremental root fixes and their regressions to this same branch.

Final PR report must contain:

1. current-head defect disposition table;
2. root causes fixed;
3. issues proven already fixed/false-positive and evidence;
4. new defects found during fresh-eye testing;
5. database/billing/idempotency evidence;
6. capability/readiness/deployment evidence;
7. mobile/desktop E2E evidence;
8. SPA smoke evidence;
9. long-running implementation + >=2h soak evidence;
10. remaining `BLOCKED_BY_EXTERNAL_DEPENDENCY` items.

The target is not “CI green”. The target is a production-like AIOS where the Agent uses the correct source/project, invokes real tools safely, verifies effects, recovers from failures, remains truthful, and is actually usable.