# Global Assistant Interaction Recovery — implementation plan

## Why this task exists

The latest default branch already contains the broad navigation, mobile, brand, accessibility, Story workspace, one-click generation, and assistant-intent fixes that older open issues still describe. Do not reimplement those stale reports.

This task closes the remaining real UX break in the global assistant: a structured interaction such as SOURCE_PICKER can remain in `waiting_user_input` indefinitely, and a blocked source explains alternatives without giving the user a real action. This corresponds to the still-reproducible core of issues #664 and #665.

The result must feel simple:

1. The assistant asks one clear question.
2. Available choices are directly actionable.
3. Blocked choices show a reason and real alternatives.
4. The user can cancel.
5. Leaving and returning never traps the conversation.
6. Expiry/cancel/retry never repeats a write, paid call, or quota charge.

## Non-conflict boundary

This work intentionally does not touch:

- `client/src/pages/ProjectPage.tsx`
- `client/src/features/story-workspace/**`
- StoryStage, storyboard, SceneStudio, CreationWorkbench, generation orchestration
- character/look/environment/prop consistency data
- training, embeddings, creative-context retrieval, or #743 runtime work
- Story workspace visual simplification or #745 runtime work
- `scripts/ci-rate-limit-worker.ts` (#746)
- global navigation, mobile bottom navigation, account shell, brand, auth, feedback widget

If implementation discovers that one of those files is necessary, stop that portion, record the dependency, and continue only with the non-overlapping assistant interaction work. Do not silently widen scope.

## Source of truth to inspect first

Read the latest default branch and repository instructions, then inspect:

- issues #664 and #665
- PRs #743, #745, and #746 and their current changed files
- `shared/assistantInteraction.ts` (or the current shared interaction contract)
- assistant conversation/checkpoint persistence services
- `server/routers/globalAssistant.ts`
- `client/src/app/components/GlobalAssistantSheet.tsx`
- the component that renders structured assistant interactions
- existing interaction lifecycle, submitInteraction, request dedupe, execution receipts, quota and audit tests

Do not assume issue line numbers are current.

## Required behavior

### 1. Durable interaction lifecycle

Use the existing conversation/checkpoint source of truth. Do not add a parallel client-only state store.

An interaction must have explicit terminal semantics equivalent to:

- pending
- submitted
- cancelled
- expired

If the existing contract uses different names, extend it compatibly rather than creating a second model.

Persist enough trusted server data to decide expiry after reload. The client may display a countdown, but it must not be the authority.

Use one documented expiry policy (recommended: five minutes unless an existing repository convention is stronger). On conversation load and before submission:

- detect stale pending interactions,
- atomically mark them expired,
- clear only the waiting state that belongs to that interaction,
- preserve conversation history and completed results,
- allow a fresh message immediately.

### 2. Cancellation

Every pending structured interaction gets one visible “取消” action.

Cancellation must:

- call a real server lifecycle mutation,
- be idempotent,
- mark the interaction terminal,
- clear the matching waiting state/active continuation safely,
- restore the normal composer,
- never execute the proposed action,
- never consume generation points or call a paid provider.

Closing the sheet is not automatically cancellation. Reopening must show the pending interaction until it is submitted, explicitly cancelled, or expired.

### 3. Safe resume and dedupe

Submission, cancellation, expiry cleanup, refresh, SSE/tRPC fallback, and double-click races must share the existing interaction/run identity.

Required invariants:

- one interaction can reach only one terminal outcome;
- the first valid terminal transition wins;
- duplicate submission returns the existing receipt/result or a harmless already-finished response;
- cancel after submit cannot roll back a completed write;
- submit after cancel/expiry cannot execute;
- reload/worker restart cannot duplicate a write, paid call, note, generation, or points charge;
- unrelated active goals are not cleared.

Implement conditional/transactional state transitions where persistence exists. Do not rely on disabled buttons alone.

### 4. Actionable blocked-source UX

For SOURCE_PICKER:

- available sources remain normal choices;
- blocked sources remain visibly disabled and expose the reason;
- the same card provides real alternative actions using existing flows:
  - “改用本機檔案” opens the existing file picker/import path;
  - “改用 Google Drive” uses the existing Drive flow when configured/connected;
  - “改用網址” uses the existing URL import flow if supported by the current capability contract.
- do not create fake buttons or pretend Google Photos is supported;
- do not duplicate upload/import logic;
- inaccessible alternatives must not be rendered as enabled actions.

The UI should show at most one primary action plus compact alternatives. On 390px portrait it must not overflow or become a nested accordion.

### 5. Recovery messaging

Use short user-facing states:

- pending: “選一個來源繼續”
- cancelled: “已取消，你可以改問其他事情”
- expired: “這個選擇已過期，請重新選擇”
- already completed: show the existing result/receipt, not an error wall

Errors must preserve retryability and must not discard a successfully completed sibling action.

## Implementation strategy

Prefer a small, reviewable implementation PR based on the latest default branch.

Expected touch area only (adapt to actual repository names):

- existing shared assistant-interaction contract
- existing assistant interaction persistence/core service
- narrowly scoped sections of `server/routers/globalAssistant.ts`
- structured interaction renderer / `GlobalAssistantSheet`
- focused unit/integration/browser tests
- evidence under `docs/evidence/global-assistant-interaction-recovery/`

Avoid schema changes if existing persisted timestamps/status fields can safely express the lifecycle. If a schema change is genuinely required, use an additive nullable/defaulted migration with backward compatibility and migration dry-run evidence.

## Required tests

At minimum add focused tests for:

1. pending interaction survives close/reopen;
2. cancellation is persisted and restores composer;
3. stale pending interaction expires on reload;
4. submit vs cancel race has one winner;
5. duplicate submit is idempotent;
6. submit after expiry is rejected without side effects;
7. blocked Google Photos shows reason plus working local/Drive/URL alternatives as available;
8. unavailable alternatives are disabled;
9. no paid/provider/quota path runs for cancel/expire;
10. 390px interaction card has no horizontal overflow and all controls are at least 44px.

Then run the repository-available checks relevant to changed files:

- targeted assistant interaction tests
- `npm run typecheck`
- `npm run check:boundaries`
- `npm run check:ui-primitives`
- `npm run check:hooks`
- `npm test`
- `npm run test:client`
- `npm run build`

Classify every failure as PASS, BASELINE_EXISTING_FAILURE, INTRODUCED_BY_THIS_PR, or BLOCKED_BY_ENVIRONMENT. Fix all introduced failures.

## PR discipline

- Create a separate implementation branch from the latest default branch after rechecking open PR diffs.
- Draft only; do not merge.
- Small explicit commits.
- No force push, reset --hard, fake data, placeholders, skipped/weakened tests, or paid provider calls.
- Before every push: `git status -sb`, `git diff --check`, `git diff --stat`.
- PR body must list actual files, real flow, idempotency proof, tests, mobile evidence, baseline failures, and remaining limitations.

## Definition of done

- A pending source choice cannot trap a conversation permanently.
- Cancel and expiry are durable and idempotent.
- Reopen/reload restores truthful state.
- Blocked sources offer real existing alternatives.
- No duplicate write, provider call, generation, note, or points charge is possible from races/retry.
- 390px portrait flow works with accessible controls.
- No Story workspace, consistency engine, generation orchestration, CI worker, or global navigation files changed.
- All introduced test failures are fixed.
