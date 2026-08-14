# Project Creative Context — progress journal

Task source: `docs/plans/PROJECT_CREATIVE_CONTEXT_AND_CONSISTENCY_ENGINE.md`  
PR #742 merge SHA: `cdde3883993d1b9b04e71e8c0ed2f213866f9368`  
Base branch: `claude/healing-migration-ai-os-erewp2` @ `cdde388`  
This PR: https://github.com/aa0968111723-prog/ai_os/pull/743  
Head: `agent/project-creative-context-plan`  
Last successful commit: `881d87c`

## Current phase

Phase 1 — Canonical context and prerequisites (continuing this PR, no duplicate Phase 1 PR).

## Checklist

- [x] Starting checks (git / remotes / #742 / #743 / AGENTS.md)
- [x] Verify still-real #742 findings
- [x] Fix still-real #742 findings with focused tests
- [x] Project Creative Context service
- [x] Entity binding, provenance, ACL, Proposal
- [x] Additive schema `0071_project_creative_context`
- [x] Progress journal
- [x] Phase 2 Shot Context Packets (stacked Draft PR)
- [x] Phase 3 Generation wiring (stacked Draft PR)
- [x] Phase 4 Consistency training (stacked Draft PR)
- [x] Phase 5 Simple UX + E2E (stacked Draft PR)

## #742 prerequisite findings

| Finding | Verdict | Fix |
|---|---|---|
| CTA says 生成影片 while batch is still-image SDXL | STILL REAL | Honest `oneClickPrimaryLabel` / `ONE_CLICK_BATCH_KIND=image` |
| Yjs flush completes before materialize | STILL REAL | `story.flushCollab` → `flushStoryDocNow` |
| Save failure / conflict still flushes | STILL REAL | flushed only on success; failed event otherwise |
| Reload / 繼續生成 duplicates awaiting_approval | STILL REAL | `batchGenerate` reuses same fingerprint |
| Nested reveal lost after lazy mount | PARTIALLY REAL | peek until the node exists, then consume |
| Mobile VisualChoiceTray missing sheet | ALREADY FIXED | existing 820px bottom sheet contract |
| One shot video treated as whole film | STILL REAL | `isAssembledProjectFilm` only |

## Schema / compatibility

Additive only:

- `story_entity_bindings`
- `story_entity_binding_proposals`

No canonical table rewrite. No second character/scene/asset/knowledge database.

## Provider / secrets

- No paid provider called
- Training action is not exposed in Phase 1 UI
- `paidCallsAuthorized` is always `false`

## Tests (this segment)

| Check | Result | Class |
|---|---|---|
| `shared/projectCreativeContext.test.ts` | 8 passed | PASS |
| `server/services/storyEntityBinding.test.ts` | 2 passed | PASS |
| `server/routers/scenes.batchGenerate.contract.test.ts` | 1 passed | PASS |
| `shared/auditWording.test.ts` | 25 passed | PASS |
| `client/.../oneClickFilm.test.ts` | passed | PASS |
| `client/.../storyInlineNav.test.ts` | passed | PASS |
| `client/.../ProjectPage.workbenchContract.test.ts` | passed | PASS |
| `client/.../storyRevealQueue.test.ts` | passed | PASS |
| `npm run typecheck` | exit 0 | PASS |
| `npm run check:hooks` | OK | PASS |
| `npm run check:boundaries` | OK | PASS |
| `projectCreativeContext.pg.test.ts` | not executed | BLOCKED_BY_ENVIRONMENT (no DATABASE_URL / Postgres) |
| `collabDoc.pg.test.ts` flush case | not executed | BLOCKED_BY_ENVIRONMENT |
| Full `npm test` / `npm run test:client` | not run this segment | not claimed |
| Known #742 CI rate-limit stdout issue | not reproduced here | BASELINE_EXISTING_FAILURE (classified, not hidden) |

## Exact next action

After Phase 1 commit/push/PR body update: open stacked Draft PRs for phases 2–5 and implement them.

## Human blockers

None yet. Paid live training remains unauthorized.
