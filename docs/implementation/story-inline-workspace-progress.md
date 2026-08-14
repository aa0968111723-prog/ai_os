# Story-inline workspace — execution journal

Long-running implementation of the story-inline generation workspace.
Do not restart from analysis; resume from the first unfinished checkbox.

## Task goal

Replace the four-stage project page (故事 / 分鏡 / 製作 / 成片) with a single
story home. Characters, scenes, props, storyboard, production, and delivery
collapse under Story. Users generate first, then expand only the broken part
and regenerate affected shots.

This is not a UI reskin. Existing Story / Scene / Shot / Character / Look /
Prop / Generation / Asset data, generation command, queue, quota, approval,
points, versions, and delivery stay the real source of truth.

## Spec sources

- Merged PR #730 (`docs(product): 計畫故事內嵌生成與按需細修流程`)
- `docs/plans/PROJECT_WORKSPACE_STORY_INLINE_GENERATION_PLAN.md` (product truth)
- `docs/plans/PROJECT_WORKSPACE_STORY_FIRST_REFACTOR.md` (data / safety / compatibility baseline; four-stage nav superseded)

## Base

- Default branch: `claude/healing-migration-ai-os-erewp2`
- Base SHA: `2e411b8ad80870c4f563a751a8111b0e59f768a1` (#730 squash merge)
- Isolated worktree: `/root/ai_os-story-inline`
- Original `/root/ai_os` left untouched on `feat/gemini-omni-remote-video`
- PR #730 was OPEN at first inspection, then MERGED. Implementation starts from latest default, not a local merge of #730.

## Current stage

PR 1 — single story home shell (implementing / committing)

## Checklist

### PR 1 — `agent/story-inline-01-shell`

- [x] Progress journal created
- [x] Baseline tests recorded
- [x] `storyInlineNav` hash / section mapping
- [x] Six collapsed summary rows under StoryStage
- [x] ProjectPage no longer uses ①②③④ as primary nav
- [x] VisualJourney / TocNav four-stage primary chrome removed
- [x] Old `#stage-*` / `#sec-*` / reveal events still reach real capability
- [x] Settings sheet, Story autosave, collab, parse, undo preserved
- [x] Contract tests updated to new IA (not four-stage primary)
- [x] Targeted + repo checks run; introduced failures fixed
- [ ] Commit + push + draft PR

### PR 2 — `agent/story-inline-02-context`

- [ ] Clickable Story chips open the matching collapsed section
- [ ] Deep edit via drawer / sheet / desktop Inspector
- [ ] Close restores scroll position
- [ ] Mobile opens one major section at a time
- [ ] Heavy managers lazy-mount
- [ ] Same queries / mutations / IDs / tables
- [ ] `projectContextNav` reveal opens the correct section

### PR 3 — `agent/story-inline-03-shot-production`

- [ ] Storyboard summary: scenes / shots / ready / warnings
- [ ] Shot drawer (no third accordion)
- [ ] CreationWorkbench via selected Shot adapter
- [ ] Version / approval / retry / cost / current pointer invariants

### PR 4 — `agent/story-inline-04-one-click-generation`

- [ ] Real one-click video orchestration
- [ ] Incremental parse, missing Scene/Shot drafts, no overwrite of human edits
- [ ] Existing generation command / queue / quota / approval / points
- [ ] Trackable batch identity, idempotent retry, reload restore

### PR 5 — `agent/story-inline-05-result-fix-delivery`

- [ ] Single “哪裡需要修改？” entry
- [ ] Diagnose → proposal → Apply/Adopt
- [ ] Impact preview + local regenerate
- [ ] Delivery collapse uses real export / share / review

## Completed

- Isolated worktree created; original workspace not reset.
- Specs and current ProjectPage / StoryStage / TocNav / contracts read.
- #730 confirmed merged at `2e411b8`. Implementation branch reset onto that default.
- PR1 shell implemented: StoryStage is the only primary surface; six collapsed rows host the existing real managers / StoryboardStage / CreationWorkbench / DeliveryRoom / SceneList / ProjectShareCard.
- Primary CTA remains the existing real parse / 產生分鏡 / 展開製作 / 觀看成果 path. No fake “生成影片” button (that is PR4).

## Incomplete

- PR1 push + draft PR
- PR2–PR5
- Mobile Playwright evidence at 390/430/768/1280/1440 (PR1 first-screen measurement pending)
- Repo-wide `npm test` / `npm run build` (running after PR1 commit)

## Last successful commit SHA

`2e411b8ad80870c4f563a751a8111b0e59f768a1` (base; PR1 commits pending)

## Branches / PRs

| Layer | Branch | Base | PR | Status |
| --- | --- | --- | --- | --- |
| Plan | `agent/story-inline-generation-plan` | default | #730 | MERGED |
| PR1 | `agent/story-inline-01-shell` | `2e411b8` | — | local, implementing |
| PR2 | — | PR1 head | — | not started |
| PR3 | — | PR2 head | — | not started |
| PR4 | — | PR3 head | — | not started |
| PR5 | — | PR4 head | — | not started |

## Tests

### Baseline (pre-change)

- Targeted client contracts were attempted with `npx vitest` before `node_modules` existed in the worktree → BLOCKED_BY_ENVIRONMENT (npx fetched vitest 4 + rolldown native binding miss). Not a product failure.
- `ProjectPage.hookOrder.test.tsx` times out at 15s on **both** this worktree and untouched `/root/ai_os` (`feat/gemini-omni-remote-video`). Classified **BASELINE_EXISTING_FAILURE / BLOCKED_BY_ENVIRONMENT**. Not treated as PR1 regression.

### PR1 targeted

| Check | Result |
| --- | --- |
| `ProjectPage.workbenchContract.test.ts` (12) | PASS |
| `ProjectPage.mobileStyles.test.ts` (4) | PASS |
| `storyInlineNav.test.ts` (4) | PASS |
| `StoryInlineSection.test.tsx` (1) | PASS |
| `projectContextNav.test.ts` (5) | PASS |
| `CostumePackSection.test.tsx` (4) | PASS |
| `TocNav.test.tsx` (3) | PASS |
| `ProjectPage.worldviewSafety.test.ts` (2) | PASS |
| `styles.mobileInteract.contract.test.ts` (4) | PASS |
| story-workspace ScriptEditor / Yjs / draft / tools | PASS |
| `check:hooks` | PASS |
| `check:boundaries` | PASS |
| `check:ui-primitives` | PASS |
| `ProjectPage.hookOrder.test.tsx` | BASELINE_EXISTING_FAILURE (15s timeout; also fails on unmodified repo) |
| `npm run typecheck` | still running / slow in this environment — will record after commit |

### Classification key

- PASS
- BASELINE_EXISTING_FAILURE
- INTRODUCED_BY_THIS_PR
- BLOCKED_BY_ENVIRONMENT

## Problems / decisions

- #730 merged while the long task started. Followed the “if merged, start from latest default” rule. Did not merge #730 locally.
- Workspace `/root/ai_os` had an unrelated clean branch. Used worktree `/root/ai_os-story-inline` instead of touching it.
- PR1 will not add a fake “生成影片” button. Primary CTA stays the existing real “產生分鏡” / open-production / watch-result actions until PR4 wires real video orchestration.
- Settings CostumePackSection uses `omitLegacyAnchors` so `#sec-characters|scenes|props` live on the story-inline rail (one id each). Settings still mounts the same Character/Scene/Prop cards.
- Collapse children mount on first open and stay mounted (hidden when closed) so CreationWorkbench draft state is not thrown away.
- Worktree has no its own `node_modules`; tests used a local symlink to `/root/ai_os/node_modules`. Symlink is not committed.

## Next precise action

Commit PR1 in small commits, push `agent/story-inline-01-shell`, open draft PR, then start PR2.

## Human blockers

None.
