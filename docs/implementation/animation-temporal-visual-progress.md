# Animation Temporal & Visual Consistency Engine — implementation progress

Authoritative plan: PR #775 / `docs/plans/ANIMATION_TEMPORAL_VISUAL_CONSISTENCY_ENGINE_MASTER_PLAN.md`.

## Baseline reconciliation

Latest default at implementation start: `7e1ff407` (#774).

The GitHub UI showed #768–#770 as merged, but their stacked bases meant latest
default contained Closure PR-A (#767) and did **not** contain these unique runtime
parts:

- #768: `mediaLineage`, `creativeContext.shotLineage`, targeted downstream artifact findings.
- #769: resolved prop transfers, multi-character routing, server-authoritative scorecard, repair UX.
- #770: PostgreSQL closure acceptance and hardening, including migration `0078`.

PR-A forward-ports the unique commits from the final audited Closure PR-D head
before adding temporal functionality. Existing records remain authoritative:

| Planned concept | Existing authoritative home extended |
| --- | --- |
| Character / Look / Scene / Prop / Style / Voice / Sound identity | existing cards + Team Canon versions + project pins |
| Sequence Lock | derived from immutable `scene_packages` + `scene_package_heads`; no new pointer/table |
| Expected shot state | frozen Shot Context Packet `continuity.currentStart/currentEnd` |
| Last explicitly adopted end state | existing `shot_continuity_states` |
| Candidate/current | existing generation + `scenes.assetId`, moved only by explicit Adopt |
| Staleness / blast radius | existing packet/scene-package dependency graphs |
| Media lineage | existing assets/generations/asset revisions/shot lineage |
| Output observations | PR-C durable evaluation evidence; never written into Canon or expected state |

## Stack

- PR-A #777 — Temporal State + Sequence Lock foundation
- PR-B #778 — Motion/Physics + cross-shot frame propagation
- PR-C #779 — Style DNA + real Multimodal Visual Judge
- PR-D #780 — Keyframe-first pipeline + targeted repair
- PR-E #781 — Animation Production Board + full-sequence acceptance

All branches are stacked Draft PRs. No auto-merge, no force-push, no paid provider
call in tests, no fake live evaluator success, and no silent Adopt.

## Definition of Done evidence

- Unit/domain: temporal, motion, evaluator, pipeline, board fixtures all pass.
- Server Vitest: 305 files / 3153 tests passed (31 files / 152 tests explicitly skipped by suite gates).
- Client Vitest: 231 files / 1944 tests passed.
- Typecheck, import boundaries, hook order and UI primitive gates passed.
- Production build passed.
- Migration 0000→0079 applied to PostgreSQL with `schema drift: none`.
- Real PostgreSQL suites: 25/25 across Team Canon, Canon pipeline, closure runtime and animation acceptance.
- Animation PG board query count: 5 at 20, 100 and 300 shots; measured 28–31 ms in the acceptance run.
- Real ffmpeg end-frame extraction produced one idempotent child asset with `asset_revisions` parent lineage.
- Expanded animation E2E: 85/85 passed; no visual provider call.
- Browser/Axe: 390, 430, 768, 1280 and 1440 all show four comparison slots, one primary CTA,
  no horizontal overflow, and zero serious/critical violations in the board.
- Manual browser walkthrough video demonstrates opening the continuity-review queue and comparison.

No paid generation/evaluator call was made. Production visual evaluation remains `not_checked`
without an explicitly configured/confirmed real Gemini call; no fixture is reachable from the
production adapter selector.

