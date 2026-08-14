# Script consistency integration — progress

Branch: `agent/script-consistency-integration`  
Base: `claude/healing-migration-ai-os-erewp2` @ `a0bdacc`  
Task source: PR #752

## FC-00

- [x] New integration branch from latest default (not edited on old stack)
- [x] Forward-port #748–#751 unique commits
- [x] #749 P1: Candidate stays off current (`preserveScenePointer` default for visual scene-bound)
- [x] #749 P1: preflight runs and rejects before `submitGenerationCore`
- [x] #749 P1: packet freeze is synchronous before submit
- [x] #749 P2: batch/approval resume passes `shotContextPacketId` into both agent runner paths
- [x] #749 P2: missing required ScenePreset blocks adopt
- [x] #726 reconciliation: `preserveScenePointer` / `sceneBackfillWhere` already in default via #729 — not blindly merged

## SCRIPT-C0–C6 (this slice)

- [x] C0 workspace projection + graph nodes/edges from existing tables
- [x] C1 reuse story entity bindings (locked re-parse already in Phase 1)
- [x] C2 packet gains reference roles + continuity start state
- [x] C3 reference-role conflict preflight
- [x] C4 inherit previous end-state unless time_jump/montage
- [x] C5 explicit `creativeContext.adoptGeneration`; evaluation cannot silent-adopt
- [x] C6 delivery blockers for missing / stale / unapproved current versions

## Tests

| Check | Class |
|---|---|
| consistencyEval (incl. scene_mismatch adopt block) | PASS |
| generationCommand #749 guards | PASS |
| projectConsistencyGraph / continuity inherit | PASS |
| delivery blockers | PASS |
| audit wording | PASS |
| PostgreSQL adopt/graph integration | BLOCKED_BY_ENVIRONMENT |
| Browser 390–1440 evidence | BLOCKED_BY_ENVIRONMENT |
| Paid mixed-model adventure E2E | BLOCKED_BY_EXTERNAL_DEPENDENCY |

## Paid provider

None called.

## Remaining

- True PostgreSQL integration of adopt + graph: BLOCKED_BY_ENVIRONMENT unless DATABASE_URL is present
- Browser 390–1440 evidence: BLOCKED_BY_ENVIRONMENT
- Live mixed-model adventure script E2E: BLOCKED_BY_EXTERNAL_DEPENDENCY (no paid gen)
