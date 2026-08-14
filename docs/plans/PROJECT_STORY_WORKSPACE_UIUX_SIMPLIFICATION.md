# AIOS Story Workspace UI/UX Simplification Task

## 0. Execution intent

This is an executable implementation specification, not a design essay.

The target is a simple Story-first project experience backed by the existing real data, generation, collaboration, billing, approval, version and delivery systems. The technical system may remain deep; the normal user should experience one clear path:

1. write or paste the story;
2. press one truthful primary action;
3. watch real progress;
4. view the latest playable result;
5. open only the problem area;
6. regenerate only the affected shots;
7. deliver from the same Story workspace.

Do not create a second project page, duplicate managers, mock progress, fake generation, or a parallel UI-only data source.

## 1. Dependency and conflict boundary

Authoritative predecessors:

- PR #742: chip-in-place single Story workspace, merged at `cdde3883993d1b9b04e71e8c0ed2f213866f9368`.
- PR #743: project creative context and consistency engine.
- PR #744: isolated CI worker protocol fix.

This planning PR is intentionally documentation-only and may exist in parallel.

Runtime UI/UX implementation must start from the final merged head of #743 (or rebase/merge that final head into the implementation branch without force-push). Do not independently edit runtime files while #743 is actively changing the same Story/context surfaces.

Before implementation:

- inspect #742 and every merged/active stacked PR produced by #743;
- inspect their complete diffs, tests, screenshots and known limitations;
- list overlapping files before editing;
- preserve #743 canonical context packets, entity bindings, training state, consistency evaluation and provider contracts;
- preserve #744 as an unrelated CI-only fix.

If #743 is still running, prepare tests, measurements and the UI view-model contract in additive files only. Do not compete over `ProjectPage.tsx`, `StoryStage.tsx`, shared generation contracts or schema.

## 2. Product outcome

The project page must feel like one creative canvas rather than an administration dashboard.

### First screen

Show only what is necessary to continue:

- project/story identity;
- story editor;
- compact save/collaboration state;
- a single truthful primary CTA;
- compact readiness explanation when blocked;
- current generation progress or latest playable result;
- one entry to fix a result.

Do not place full model matrices, large management cards, advanced generation parameters, delivery forms, asset tables, training controls or database controls on the first screen.

### Progressive disclosure

The Story chips remain the only main disclosure controls:

- characters;
- looks/costumes;
- scenes;
- props;
- storyboard;
- production;
- delivery;
- knowledge/context when relevant.

One chip opens one in-place slot directly below the chips. Selecting another chip replaces the slot. Selecting the active chip closes it. On mobile, only one major panel can be open.

Entity and Shot deep editing uses a mobile sheet/drawer or desktop inspector. Closing it restores the prior Story scroll/focus position.

### Simple language

Normal UX must speak in creative outcomes, not backend implementation terms.

Examples:

- “正在整理故事” instead of parser internals;
- “正在準備 8 個鏡頭” instead of queue implementation names;
- “2 個鏡頭需要確認” instead of raw status enums;
- “保持角色一致” instead of LoRA/adapter/provider jargon;
- “已使用專案角色與素材” with an optional detail disclosure showing exact sources.

Advanced users may open technical details, but technical controls must never be required for a first draft.

## 3. Truthful primary-action state machine

There must be exactly one dominant CTA in the normal flow. Its label and action are derived from persisted truth, not optimistic UI guesses.

Required states include:

- empty story → disabled with direct explanation;
- unsaved story → save then continue;
- unparsed/changed story → prepare story and generation inputs;
- blocked by permission/quota/approval/provider → show the real blocker and one correct recovery action;
- ready shots → generate the first playable version;
- active batch → show progress and allow safe navigation without starting a duplicate batch;
- partial success → play completed output and retry only failed/blocked scope;
- completed playable film → play/view result;
- stale affected shots → regenerate affected shots;
- no playable film but only still images → never label it “finished film”;
- delivered version → view delivery and create a new version without overwriting history.

The CTA must call existing commands and gates. It must not bypass ACL, quota, approval, points, provider routing, idempotency, current/candidate selection, or Yjs/autosave rules.

## 4. Readiness and progress UX

Replace scattered status noise with one compact, expandable status surface.

Collapsed state shows:

- current step in plain language;
- meaningful progress based on persisted batch/shot state;
- counts of completed, running, waiting approval, blocked and failed shots;
- whether the visible result is playable;
- the next safe action.

Expanded details may show exact shots, costs, approvals, provider/model details and retry reasons.

Requirements:

- reload reconstructs the same state from persisted records;
- no fake percentage based only on elapsed time;
- partial successes remain visible and playable;
- waiting approval is distinct from failure;
- cancelled and superseded runs cannot continue to look active;
- duplicate pending batches are not created by repeated taps;
- save or Yjs materialization failure must reach this surface and block generation truthfully.

## 5. Result-first correction loop

After generation, prioritize playback/result over configuration.

The result surface must provide:

- latest playable whole-film result when one exists;
- truthful fallback when only shot clips or stills exist;
- timeline/shot mapping;
- one “哪裡需要修改？” entry;
- direct jump from a timestamp or failed shot to the correct character/look/scene/prop/storyboard/production panel;
- visible affected-shot count before applying a broad change;
- regenerate affected shots only;
- clear distinction between proposal, applied change, candidate generation and adopted current version.

Do not silently adopt candidates. Do not rebuild the whole film for a single-shot correction unless a real dependency calculation requires it and the user confirms the scope.

## 6. Project context and consistency UX

Use #743’s real project context engine; do not duplicate it.

The normal user sees a compact “一致性” summary:

- ready / learning / needs references / issue found;
- which project characters, looks, scenes, props, knowledge and assets are being used;
- missing or low-confidence references only when actionable;
- one simple action such as “補一張角色參考” or “確認這個場景”.

Training/provider implementation stays behind an advanced disclosure. The normal flow must not ask users to choose embeddings, adapters, epochs, ranks, checkpoints or provider-specific parameters.

Explicit consent and rights state are still required before real training. Paid training or provider calls require existing authorization and cost gates.

## 7. Mobile UX requirements

The full primary flow must work at 390px portrait:

- write/edit story with the keyboard open;
- see save state;
- trigger the one primary action;
- inspect real progress;
- play/view result;
- choose a problem timestamp/shot;
- open one correction panel;
- apply a change preview;
- regenerate affected shots;
- deliver.

Hard requirements:

- no horizontal overflow;
- touch targets at least 44×44 CSS pixels;
- sticky UI must respect header, bottom navigation, keyboard and safe-area insets;
- only one floating assistant entry and one dominant CTA;
- drawers/sheets have focus trap, Escape/back behavior, labelled close control and focus restoration;
- no content hidden under assistant orb, comments button, browser keyboard or action dock;
- reduced motion is respected;
- screen-reader names describe outcome, state and cost impact;
- 200% text zoom remains operable.

Validate at 390, 430, 768, 1280 and 1440 widths using the real browser workflow, not CSS inspection alone.

## 8. Implementation shape

Prefer a small presentation/view-model layer derived from existing authoritative queries and persisted records.

It may normalize:

- primary CTA state;
- readiness summary;
- batch/shot progress;
- playable result truth;
- stale/affected scope;
- context-consistency summary.

It must not persist a second copy of Story, Character, CharacterLook, Scene, Shot, Prop, AssetRevision, Generation, training job or delivery state.

Reuse existing Story chips, reveal events, `StoryResultFix`, `StoryboardStage`, `SceneStudio`, `CreationWorkbench`, delivery components and #743 context engine. Heavy panels remain lazy-mounted.

Avoid a large rewrite of `ProjectPage.tsx`. Extract presentation components only where this reduces cognitive/technical coupling and keeps canonical mutations in their current owners.

## 9. Recommended implementation PRs

Create stacked Draft PRs only after the dependency boundary in §1 is satisfied.

### UIUX-1 — Truthful first screen and primary CTA

- add the derived primary-action state;
- remove duplicate dominant actions;
- compact save/readiness/collaboration indicators;
- ensure still-image results are not called films;
- preserve old routes, anchors and reveal events.

### UIUX-2 — Persistent progress and result-first surface

- unify batch/shot progress;
- restore progress after reload;
- show partial success and approval distinctly;
- prioritize playback and the single correction entry;
- prevent repeated taps from presenting duplicate active work.

### UIUX-3 — Mobile correction and delivery flow

- mobile sheet/drawer for entity and shot details;
- scroll/focus restoration;
- timestamp/shot-to-panel navigation;
- affected-scope preview and partial regeneration;
- delivery from the same Story workspace;
- keyboard, accessibility and viewport verification.

Each PR must be reviewable, Draft, non-auto-merged and free of unrelated changes.

## 10. Tests and evidence

Before changes, record a baseline on the exact implementation base.

For each PR run relevant targeted tests, then repository-available gates:

- `npm run typecheck`
- `npm run check:boundaries`
- `npm run check:ui-primitives`
- `npm run check:hooks`
- `npm test`
- `npm run test:client`
- `npm run build`

Required behavioral tests:

- CTA state table, including still-only vs playable film;
- save/Yjs failure propagation;
- repeated primary-action taps do not surface duplicate active batches;
- reload restores authoritative progress;
- partial success preserves successful siblings;
- approval and quota blockers remain enforced;
- proposal does not mutate until Apply;
- candidate does not become current until Adopt;
- reveal event opens the correct single slot, including lazy/nested replay;
- closing a mobile editor restores focus and scroll;
- 44px targets, no overflow and no occlusion at required widths.

Store browser screenshots, measurements and interaction logs under:

`docs/evidence/story-workspace-uiux/`

Classify every failure as:

- PASS
- BASELINE_EXISTING_FAILURE
- INTRODUCED_BY_THIS_PR
- BLOCKED_BY_ENVIRONMENT

All introduced failures must be fixed before the next stacked PR.

## 11. Progress and interruption recovery

Create or update:

`docs/implementation/story-workspace-uiux-progress.md`

Record:

- dependency PR/SHA;
- implementation branch and base SHA;
- current phase/checklist;
- overlap review against #743;
- commits and Draft PR links;
- tests and evidence;
- baseline vs introduced failures;
- exact next command;
- genuine blockers only.

At every verified checkpoint: inspect diff, run targeted tests, update the journal, commit clearly, push, and update the Draft PR body.

Never force-push, auto-merge, reset hard, delete user data, weaken tests, fake browser evidence or invoke paid providers merely for UI validation.

## 12. Definition of Done

Done means all of the following are true:

- the project reads as one Story workspace, not four stages or an ERP dashboard;
- the first screen has one truthful dominant action;
- users can generate a first version without opening advanced panels;
- real persisted progress survives reload;
- latest playable output is immediately visible;
- stills are never mislabeled as a finished film;
- users can identify a bad timestamp/shot and reach the correct panel;
- broad changes show affected scope before Apply;
- only affected shots regenerate;
- delivery remains in the same Story workspace;
- #743 project context and consistency capabilities are used without exposing training complexity;
- mobile portrait completes the full flow;
- old projects, routes, anchors, data, permissions, billing, approvals, versions and collaboration still work;
- no second data source, duplicate manager, fake progress or placeholder control exists;
- all introduced test failures are fixed;
- evidence and progress journal are current.
