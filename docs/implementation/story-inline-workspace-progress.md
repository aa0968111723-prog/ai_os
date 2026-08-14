# Story-inline workspace — execution journal

Long-running implementation of PR #742 (chip-driven in-place Story workspace).
Do not restart from analysis; resume from the first unfinished checkbox.

## Task goal

The red Story analysis chips are the only primary disclosure controls. Tapping a chip opens the matching real manager in one reveal slot immediately under the chips. The #731 lower duplicate accordion rail is gone. #733–#736 real capabilities stay.

## Git topology (ancestry, not GitHub “merged” alone)

| Ref | SHA | Fact |
| --- | --- | --- |
| Default `claude/healing-migration-ai-os-erewp2` | `edd45b3e` | Contains #731 + #732 + #737. |
| Safe merge default → #742 | `ba5bf07a` | No force-push. |
| Runtime implementation | `93ebe126` | Chip slot + readiness + reveal queue. |
| Merge-base with default | `edd45b3e` | 0 behind after merge. |

### #731–#740 actual merge topology

| PR | Actual base | In default? |
| --- | --- | --- |
| #731 | default | **Yes** |
| #732 | default | **Yes** |
| #733–#736 | stacked story branches | **No** — live on this head |
| #737 | default | **Yes** |
| #738–#740 | stacked nav branches | **No** — not mixed into #742 |

## Draft PR

https://github.com/aa0968111723-prog/ai_os/pull/742
Head: `agent/story-inline-06-chip-workspace`

## Checklist

- [x] Confirm default SHA and #731–#740 ancestry
- [x] Safe-merge latest default
- [x] Six primary chips + contextual 製作／交付
- [x] Single `#story-reveal-slot` under chips
- [x] Toggle / replace / aria-expanded / 44px
- [x] Remove ProjectPage second rail
- [x] Legacy anchors next to Story
- [x] Lazy mount + `storyRevealQueue`
- [x] Readiness includes `isDirty`; 成片 = video only
- [x] Settings modal closes before slot
- [x] Targeted + repo checks
- [x] 390 / 430 / 768 / 1280 / 1440 evidence
- [ ] Keep Draft; human review (do not merge)

## Preserved

Story autosave / Yjs / parse / undo; CharacterCards / ScenePresetCards / PropCards; StoryboardStage / SceneStudio / applyPrompt; single CreationWorkbench; useOneClickFilm; StoryResultFix / regenShots; DeliveryRoom / SceneList / share; projectContextNav; old hashes and `?focus=`.

## Tests

| Check | Result |
| --- | --- |
| Targeted chip / nav / queue / readiness / diagnosis / workbench (42) | PASS |
| Broader story / board / ProjectPage client (142) | PASS |
| `npm run typecheck` | PASS |
| `npm run check:boundaries` | PASS |
| `npm run check:ui-primitives` | PASS |
| `npm run check:hooks` | PASS |
| `npm test` (2934 passed / 119 skipped) | PASS |
| `npm run test:client` (1866 passed) | PASS |
| `npm run build` | PASS |
| Playwright 390/430/768/1280/1440 chip slot | PASS |
| Paid-provider live generation | BLOCKED_BY_ENVIRONMENT (used E2E_MOCK=1) |
| Updating GitHub PR body via token | BLOCKED_BY_ENVIRONMENT (403 / not agent-managed) |

No INTRODUCED_BY_THIS_PR failures. Skipped tests are pre-existing suite skips, not weakened for this PR.

## Evidence

`docs/evidence/story-inline-workspace/pr-742/`

## Last successful commit SHA

Update after this journal commit.

## Next precise action

Human review of Draft PR #742. Do not merge.

## Human blockers

None required for the layout integration. Live paid generation and PR-body overwrite need human/env access.
