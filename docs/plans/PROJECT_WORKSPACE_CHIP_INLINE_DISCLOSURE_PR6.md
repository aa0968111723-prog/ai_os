# Story-inline PR 6 — chip-driven in-place workspace

> Status: implementation checkpoint for a Draft integration PR  
> Product decision: the Story analysis chips are the workspace disclosure controls.  
> Base capability branch: PR #736 head `agent/story-inline-05-result-fix-delivery`.

## 1. Why this PR exists

PRs #731–#736 already built the story-inline capability stack:

- #731: single Story home shell and six collapsed capability rows.
- #733: clickable Story chips, mobile `StoryContextSheet`, lazy mounting.
- #734: storyboard summary, existing SceneStudio, selected-shot handoff to the single CreationWorkbench.
- #735: real one-click flow through save/parse/materialize/batchGenerate/approval.
- #736: result diagnosis, affected-shot regeneration and existing delivery tools.

The remaining product mismatch is location and hierarchy.

The user does **not** want a chip click to jump to a second set of large rows farther down the page, and does not want the mobile primary reveal to feel like another page. The matching cards must appear directly below the red Story chips, inside the same Story workspace.

## 2. Git topology that implementation must preserve

PRs #733–#736 were merged into stacked feature branches, not into the repository default branch. This PR intentionally starts from the final story capability branch so none of those real features are recreated or lost.

Before implementation finishes:

1. Merge the latest default branch `claude/healing-migration-ai-os-erewp2` into this branch without force-push.
2. Resolve overlap conservatively, especially `client/src/styles.css`.
3. Preserve #737–#740 global-navigation behavior.
4. Target the default branch with this Draft PR.
5. Do not create another Character/Scene/Shot/Generation data source.

## 3. Final information architecture

The project has one Story workspace.

Collapsed state shows:

1. Story editor and save/dirty state.
2. Analysis chips.
3. One truthful primary generation CTA.
4. Current real batch progress.
5. Latest playable result when one exists.
6. One “哪裡需要修改？” entry after results exist.

All detailed capabilities are disclosed inside the Story workspace.

### Chip controls

- 角色
- 場景
- 道具
- 造型
- 分鏡
- 標記
- 製作
- 交付, only when contextually applicable

Tapping a chip renders its matching capability in **one shared reveal slot immediately under the chip group**.

Rules:

- Tap `角色 29` → character cards appear under the chip row.
- Tap `場景 27` → the same slot switches to scene cards.
- Tap the selected chip again → collapse the slot.
- At most one primary reveal panel is open.
- No scroll to a duplicate lower rail.
- No second set of 角色／場景／道具／分鏡／製作／交付 rows.
- Deep editing one entity or Shot may use a full-screen sheet/drawer on mobile and Inspector/modal on desktop.
- Closing deep edit restores the Story scroll position.
- Heavy managers lazy-mount on first reveal and retain draft state afterwards.

## 4. Reuse the existing real capabilities

| Story control | Existing capability to reuse |
| --- | --- |
| 角色 | `CharacterCards` and existing character queries/mutations |
| 造型 | existing CharacterLook / costume capabilities |
| 場景 | `ScenePresetCards` and existing scene preset mutations |
| 道具 | `PropCards` and existing prop mutations |
| 分鏡 | PR #734 `StoryboardStage`, summary, SceneStudio |
| 標記 | existing pending candidates/markers |
| 製作 | PR #734 single `CreationWorkbench` / SceneStudio adapters |
| 生成影片 | PR #735 one-click orchestration and existing agent approval |
| 成果修正 | PR #736 `StoryResultFix` and affected-shot batch regeneration |
| 交付 | existing DeliveryRoom, SceneList, share/export/review/LumaFusion |

Moving a component into the reveal slot must not simplify, duplicate or replace its backend path.

## 5. Generation and result remain inside Story

The real first-version generation action belongs to Story. The user must not have to open 製作 before generating.

Inside Story:

- generation CTA
- truthful cost/approval state
- real agent/batch progress
- retry and partial failure state
- playable result
- result diagnosis
- affected-shot regeneration
- delivery disclosure

製作 is advanced control, not a prerequisite page.

Truthful labels:

- a completed image generation = “已有畫面” or “已有生成結果”
- “已有成片／觀看影片” requires a real playable assembled video/deliverable
- a dirty Story must not advertise stale parsed scenes as current

## 6. Compatibility and post-#731 defects

Preserve old routes, hashes, anchors, notifications, collaboration views and reveal events.

Targets including `#sec-characters`, `#stage-board`, `#stage-create`, `#stage-deliver`, and `?focus=generation-<id>` must:

1. Select/open the matching Story chip.
2. Wait until lazy content is mounted.
3. Reveal the requested nested target.
4. Keep browser-back and focus behavior reasonable.

Fix while moving the slot:

- blank-story “與 AI 一起開始” opens/mounts production before assistant reveal
- generation focus waits for CreationWorkbench mount
- settings summary chips do not open obscured content behind an active modal
- presenter-follow opens the relevant chip panel before nested navigation
- readiness includes `story.isDirty`
- image/generic generation state is not called a finished film

## 7. Data and safety invariants

Preserve:

- Story autosave, Yjs, revisions, conflict handling and undo
- all existing Character, CharacterLook, ScenePreset, Prop, StoryScene, Shot/Scene, Generation, AgentRun and Asset IDs
- permission and viewer read-only behavior
- quota, points, approval and provider routing
- Candidate/current separation; only explicit Apply/Adopt changes current
- idempotent retry and no duplicate charge
- partial success and reload recovery
- real export, share, review and delivery

No schema migration is expected.

## 8. Mobile acceptance

Test with actual browser interaction at:

- 390×844
- 430×932
- 768×1024
- 1280×800
- 1440×900

At 390px:

- chips wrap without horizontal overflow
- touch targets are at least 44px
- reveal slot appears immediately below chips
- switching chips does not jump down the project page
- only one primary reveal panel is open
- header, bottom nav, AI orb and comment UI do not obscure Story content
- deep editor close restores the prior Story position
- only one AI entry and one primary generation CTA are visible

Commit evidence to:

`docs/evidence/story-inline-workspace/pr6-chip-in-place/`

## 9. Required tests

Add targeted tests for:

- chip → matching in-place panel
- selected chip toggles closed
- switching chips reuses the single slot
- duplicate lower rail absent
- lazy mount and state preservation
- legacy selector → open chip → nested reveal after mount
- settings-modal navigation
- presenter-follow navigation
- dirty Story readiness
- image result not labelled finished film
- #734/#735/#736 capabilities remain reachable

Run repository checks and classify each result as:

- PASS
- BASELINE_EXISTING_FAILURE
- INTRODUCED_BY_THIS_PR
- BLOCKED_BY_ENVIRONMENT

All introduced failures must be fixed before ready-for-review.

## 10. Definition of done

- The red Story chips are the only primary disclosure controls.
- Matching real cards render in-place below the chips.
- The #731 lower duplicate rows are removed.
- PR #733–#736 functionality is preserved, not recreated.
- Generation, progress, result, diagnosis, local regeneration and delivery stay inside Story.
- Old deep links and collaboration navigation work.
- No fake action, placeholder flow or parallel data store.
- Default-branch navigation work remains intact.
- Mobile evidence and progress journal are current.
