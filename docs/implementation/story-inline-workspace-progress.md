# Story-inline workspace — execution journal

Long-running implementation of PR #742 (chip-driven in-place Story workspace).
Do not restart from analysis; resume from the first unfinished checkbox.

## Task goal

The red Story analysis chips (角色、場景、道具、造型、分鏡、標記, plus contextual 製作／交付) are the only primary disclosure controls. Tapping a chip opens the matching real manager in **one reveal slot immediately under the chips**. Tapping again collapses. Switching chips replaces the same slot. The #731 lower duplicate accordion rail is gone.

This is layout / interaction integration. #733–#736 real data, generation, diagnosis, and delivery stay.

## Spec sources

- `docs/plans/PROJECT_WORKSPACE_CHIP_INLINE_DISCLOSURE_PR6.md` (this PR)
- `docs/plans/PROJECT_WORKSPACE_STORY_INLINE_GENERATION_PLAN.md`
- `docs/plans/PROJECT_WORKSPACE_STORY_FIRST_REFACTOR.md`

## Git topology (ancestry, not GitHub “merged” alone)

| Ref | SHA | Fact |
| --- | --- | --- |
| Default `claude/healing-migration-ai-os-erewp2` | `edd45b3e` | Latest default. Contains #731 + #732 + #737. |
| #742 head (this branch) before runtime | `f51eb63a` | Spec-only checkpoint. |
| Safe merge default → #742 | `ba5bf07a` | No force-push. Kept #733–#736 story files; kept #737 4-col bottom nav in CSS. |
| Merge-base with default after merge | `edd45b3e` | 0 behind / 9 ahead (then this runtime). |

### #731–#740 actual merge topology

| PR | GitHub state | Actual base | In default? |
| --- | --- | --- | --- |
| #731 | MERGED | default | **Yes** (`be8ff8be`) — story shell + lower six accordion rows |
| #732 | MERGED | default | **Yes** (`4e3a782a`) — global nav spec |
| #733 | MERGED | stacked story branch | **No** — chips / sheet / lazy mount live on #742 head |
| #734 | MERGED | stacked story branch | **No** — Storyboard / SceneStudio / workbench adapter |
| #735 | MERGED | stacked story branch | **No** — real one-click film |
| #736 | MERGED | stacked story branch | **No** — result diagnosis / local regen / delivery |
| #737 | MERGED | default | **Yes** (`edd45b3e`) — bottom nav 今日／專案／AI／更多 |
| #738–#740 | MERGED | stacked nav branches | **No** — not mixed into #742 |

Do not cherry-pick #738–#740 into this PR.

## Current stage

PR #742 runtime implementation — chip in-place reveal slot.

Draft PR: https://github.com/aa0968111723-prog/ai_os/pull/742
Head branch: `agent/story-inline-06-chip-workspace`

## Checklist

### Topology / safety

- [x] Confirm default SHA and #731–#740 ancestry
- [x] Safe-merge latest default into #742 head (`ba5bf07a`)
- [x] Do not force-push / reset --hard / open a duplicate PR
- [x] Do not mix #738–#740 into this branch

### Runtime IA

- [x] Six primary chips always: 角色／場景／道具／造型／分鏡／標記
- [x] Contextual extra chips: 製作／交付 when scenes or playable results exist
- [x] Single `#story-reveal-slot` immediately under chips
- [x] Same chip toggles closed; other chip replaces slot
- [x] Chip `aria-expanded` / `aria-controls` / keyboard / 44px touch
- [x] Remove ProjectPage `story-inline-rail` / `StoryInlineSection` second nav
- [x] Legacy `#stage-*` / `#sec-*` anchors stay near Story (not a bottom rail)
- [x] Managers lazy-mount and stay mounted (hidden) after first open
- [x] Same Character / Scene / Prop / Storyboard / CreationWorkbench / Delivery queries

### Known-issue fixes

- [x] Readiness includes `story.isDirty` / local dirty
- [x] `isPlayableFilmAsset` — only `assetKind === "video"` is 成片
- [x] Settings modal chips close modal, then open the slot
- [x] Blank-story「與 AI 一起開始」publishes durable production + `#sec-assistant`
- [x] `?focus=generation-*` opens production + `#sec-generations` and polls
- [x] Presenter-follow opens the matching slot before nested navigate
- [x] `storyRevealQueue` survives lazy mount
- [x] Mobile slot / readiness pad above FAB rail (`--fab-slot`)

### Tests / evidence

- [ ] Targeted chip / nav / queue / readiness / diagnosis tests
- [ ] `npm run typecheck`
- [ ] `npm run check:boundaries`
- [ ] `npm run check:ui-primitives`
- [ ] `npm run check:hooks`
- [ ] `npm test`
- [ ] `npm run test:client`
- [ ] `npm run build`
- [ ] 390 / 430 / 768 / 1280 / 1440 evidence in `docs/evidence/story-inline-workspace/pr-742/`
- [ ] Update Draft PR #742 description; keep Draft

## Preserved capabilities

- Story autosave, Yjs, parse, undo, versions, conflict
- CharacterCards / ScenePresetCards / PropCards (same IDs / mutations)
- Looks remain on the existing character / shot look path (no second store)
- StoryboardStage, VisibleCreativeWorkspace, SceneStudio, selected-shot `applyPrompt`
- Single CreationWorkbench
- `useOneClickFilm` save → parse → storyboard → batchGenerate → approval
- StoryResultFix + affected-shot `regenShots`
- DeliveryRoom / SceneList / ProjectShareCard
- `projectContextNav` reveal mapping
- Old hashes, `?focus=`, presenter follow

## Removed duplicate navigation

- ProjectPage no longer renders two `story-inline-rail` accordion groups
- ProjectPage no longer uses `StoryInlineSection` as a second nav
- Chip click uses `scroll: false` and does not jump to a lower rail
- Legacy anchors moved next to `#stage-story` so hash targets stay in the Story workspace

## Last successful commit SHA

`ba5bf07a` (merge default). Runtime files are local until the next commit.

## Tests

### Baseline (pre-runtime, #742 spec head)

Not re-run as a frozen snapshot in this environment. #731 contract tests still expected `StoryInlineSection` / six accordion rows — those are **intentionally updated** by this PR, not skipped.

### Classification key

- PASS
- BASELINE_EXISTING_FAILURE
- INTRODUCED_BY_THIS_PR
- BLOCKED_BY_ENVIRONMENT

## Next precise action

1. Commit + push runtime + contract updates to `agent/story-inline-06-chip-workspace`.
2. Run targeted then repo-wide checks; fix INTRODUCED_BY_THIS_PR only.
3. Capture viewport evidence.
4. Update PR #742 description; keep Draft.

## Human blockers

None yet.
