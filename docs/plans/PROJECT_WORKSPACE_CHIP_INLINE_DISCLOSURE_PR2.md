# Story-inline PR 2 — chip-driven inline workspace

## Status

Implementation checkpoint for Draft PR 2. This specification supersedes the PR #731 layout choice that rendered a second set of large collapsed rows below the story/result.

Base: merged PR #731 on `claude/healing-migration-ai-os-erewp2`.

## Product decision

The project has one Story workspace. All creation capabilities remain real and complete, but their entry points are compressed into the Story surface.

The analysis chips already shown inside `StoryStage` are the disclosure controls:

- 角色
- 場景
- 道具
- 造型
- 分鏡
- 標記
- 製作
- 交付（shown contextually when a real deliverable exists）

Clicking a chip must reveal the matching real capability immediately below the chip group, inside the same Story card/workspace. It must not scroll to or reveal a duplicate section farther down the page.

## Required interaction

1. Tap `角色 29`.
2. Character cards render directly below the chip row.
3. Tap `場景 27`.
4. The same reveal slot switches to scene cards; characters close.
5. Tap the selected chip again to collapse the slot.
6. A single character/look/scene/prop/shot opens in a mobile full-screen sheet or bottom drawer; desktop may use an Inspector.
7. Closing deep edit restores the Story scroll position.
8. At mobile widths only one primary reveal panel may be open.
9. Heavy managers lazy-mount on first reveal and preserve draft state after they have mounted.

## Story workspace layout

The normal collapsed surface contains only:

1. Story editor and save/dirty state.
2. Analysis/data chips.
3. One inline reveal slot.
4. One truthful primary generation CTA.
5. Real generation/batch progress.
6. Latest playable result when one exists.
7. One “哪裡需要修改？” entry after a result exists.

Remove the duplicate lower-page rows introduced by #731:

- 角色
- 場景
- 道具
- 分鏡
- 製作
- 交付

Their components and data must not be deleted. Move/reuse them in the Story reveal slot.

## Capability mapping

| Chip/action | Existing real capability |
| --- | --- |
| 角色 | `CharacterCards` and existing character mutations |
| 造型 | existing `CharacterLook` / costume capabilities |
| 場景 | `ScenePresetCards` and existing scene mutations |
| 道具 | `PropCards` and existing prop mutations |
| 分鏡 | `StoryboardStage`, then selected Shot drawer |
| 標記 | existing pending candidates/markers; no new marker database |
| 製作 | `CreationWorkbench` / `SceneStudio` through existing adapters |
| 交付 | `DeliveryRoom`, `SceneList`, share/export/review capabilities |

Do not create a second data source or reduced “story-only” copy of any manager.

## Generation stays inside Story

The real `生成影片` entry, progress, approval/quota/points gates, retry state, and result player belong to the Story workspace.

The user must not have to open the 製作 chip before generating a first version. 製作 is advanced configuration and diagnosis, not a prerequisite page.

Until true video orchestration is wired, the UI must describe facts precisely:

- A completed image generation is “已有畫面” or “已有生成結果”, not “已有成片”.
- “觀看影片/已有成片” requires a real playable assembled video/deliverable.
- Editing a parsed story must mark readiness dirty and must not advertise stale scenes as current.

## Compatibility

Keep old routes, hashes, anchors, reveal events, collaboration follow, notifications and generation focus links.

Compatibility targets such as `#sec-characters`, `#stage-board`, `#stage-create`, and `#stage-deliver` must:

1. Open the matching chip panel.
2. Wait for lazy content to mount.
3. Then focus/scroll/reveal the requested nested target.

Do not dispatch nested workbench reveal before `CreationWorkbench` mounts.

When navigation starts inside the project settings modal, either stay in the visible modal surface or close it before opening the Story reveal slot. Never open content behind an active modal.

Presenter-follow must open the relevant chip panel before navigating to its internal anchor.

## PR #731 follow-up defects included

- Blank-story “與 AI 一起開始” must open/mount production before revealing the assistant.
- `?focus=generation-<id>` must defer reveal until the workbench is mounted.
- Settings summary chips must not reveal obscured content behind the modal.
- Presenter-follow must open hidden Story panels.
- Readiness must include `story.isDirty`.
- A generic `scene.assetId` or completed generation must not be labelled as a finished film.
- Update `docs/implementation/story-inline-workspace-progress.md` with real PR/SHA/test state.

## Data and safety invariants

Preserve:

- Story autosave, Yjs collaboration, revision conflicts and undo.
- Existing Character, CharacterLook, ScenePreset, Prop, StoryScene, Shot/Scene, Generation and Asset IDs.
- Permission and viewer read-only behavior.
- Quota, points, approval and provider routing.
- Candidate/current version separation; only explicit Apply/Adopt changes current.
- Idempotent retry and no duplicate point charge.
- Partial success and persisted reload recovery.
- Existing export, share, review and delivery behavior.

No schema migration is expected for this PR.

## Mobile acceptance

Verify with actual browser interaction at 390, 430, 768, 1280 and 1440 px.

At 390 px:

- Chips wrap without horizontal overflow.
- Tap targets are at least 44 px.
- The reveal slot appears immediately below chips.
- Switching chips does not jump to the bottom of the project page.
- The story, save state and reveal panel are not obscured by header, bottom nav, AI orb or comment button.
- Deep edit opens a sheet/drawer and closing it restores the previous Story position.
- Only one AI entry and one primary generation CTA are visible.

Store screenshots and measurements under:

`docs/evidence/story-inline-workspace/pr2-chip-workspace/`

## Tests

Add targeted tests for:

- chip → matching reveal panel
- one-open-panel behavior
- selected chip toggles closed
- lower duplicate rows absent
- legacy selector → chip panel → nested reveal after mount
- settings-modal navigation
- presenter-follow navigation
- dirty-story readiness
- image result is not labelled finished film
- lazy mount and state preservation

Then run the repository checks required by the long-task specification. Classify every failure as PASS, BASELINE_EXISTING_FAILURE, INTRODUCED_BY_THIS_PR or BLOCKED_BY_ENVIRONMENT.

## Definition of done

- The red Story chips are the only primary disclosure controls.
- Matching real cards appear in-place below the chips.
- The #731 lower duplicate rail is removed.
- Generation, progress, results, diagnosis and delivery remain in Story.
- Old capabilities and deep links still work.
- No fake buttons, placeholder flows or parallel data stores.
- No introduced test failure.
- Mobile evidence is committed.
