# Project Creative Context & Consistency Engine

Status: executable long-task specification  
Repository: aa0968111723-prog/ai_os  
Prerequisite: PR #742 merged as cdde3883993d1b9b04e71e8c0ed2f213866f9368  
This PR is the authoritative task specification and the first implementation branch. Continue this branch for Phase 1; do not open a duplicate Phase 1 PR.

## 1. Outcome

Deeply connect the project page's existing characters, CharacterLooks, scenes, environment states, props, assets, knowledge, structured database rows and world rules to story parsing, screenplay planning, storyboard generation, shot generation and consistency control.

The technical implementation may be deep. The default UX must stay simple:

1. User creates or approves project characters, looks, scenes, props, assets and knowledge.
2. User writes a story in the existing single Story workspace.
3. User keeps using the existing primary generation CTA.
4. The system automatically grounds the story and every shot in the real project records.
5. Generated shots use the correct identities, looks, locations, props, approved references and continuity.
6. Problems can be traced to the affected entity or shot and only affected shots are regenerated.
7. When enough approved material exists, the UI may offer “加強角色一致性”.
8. Training creates a candidate model version. Human Promote is required before it becomes active.

Do not restore the old four-stage navigation. Do not redesign ProjectPage. Do not create a second database or a fake production flow.

## 2. Required starting checks

Before editing:

- git status -sb
- git remote -v
- git fetch --all --prune
- gh auth status
- gh pr view 742
- gh pr view this PR, including full diff, review and comments
- confirm latest default contains cdde3883993d1b9b04e71e8c0ed2f213866f9368
- inspect all open PRs touching StoryStage, ProjectPage, StoryboardStage, CreationWorkbench, knowledge, assets, generation continuity, provider routing or training
- read every applicable AGENTS.md and repository instruction
- establish baseline tests on the exact base

If the working tree contains unrelated changes, preserve them and use an independent worktree. Never stash, reset or overwrite user work. Never use git reset --hard or force push.

Known baseline signal: #742 CI previously failed in the distributed rate-limit check because a database diagnostic line appeared on stdout before the worker JSON. Reproduce and classify it honestly. Do not hide it or broaden this task into an unrelated CI rewrite.

## 3. Mandatory prerequisite review of #742

#742 was merged, but post-merge automated review identified generation-path risks. Verify each finding against current default before building the new Context Engine:

- The main CTA says “生成影片” while the current batch model may only produce per-shot still images.
- Yjs collaborative editing may report flush completion before server materialization.
- Story save failure or revision conflict may still resolve the flush and allow generation from stale server text.
- Reload or repeated “繼續生成” may create duplicate awaiting-approval batches and duplicate charge risk.
- A queued nested generation reveal may lose its nested selector after lazy mount.
- Mobile may hide VisualChoiceTray without an equivalent sheet.
- Any one shot video may be incorrectly treated as an assembled whole-project film.

Fix only findings that are still real, with focused tests, before relying on the corresponding path. Do not undo #742's chip-in-place Story workspace.

## 4. Existing systems to audit and reuse

Read and trace at minimum:

- ProjectPage and StoryStage
- StoryInlineSection, StoryResultFix, useOneClickFilm, oneClickFilm and storyInlineNav
- projectContextNav and reveal queue
- StoryboardStage, SceneStudio and CreationWorkbench
- CharacterCards, CharacterLook managers, ScenePresetCards and PropCards
- SceneList and DeliveryRoom
- Story, Scene, Shot, Generation and revision shared types
- story.parse and story.generateStoryboard
- batchGenerate and generationCommand
- provider routing and aiModelPolicy
- quota, points, approval, retry and idempotency
- Generation/current pointer and continuity lineage
- assets, AssetRevision, upload, storage and durability
- knowledge, Intelligence Library, data_files and data_rows
- project-scoped Data Hub bindings
- agentRuns, workflowRuns and durable background jobs
- existing embeddings, retrieval, vision evaluation, image references and training providers
- Drizzle schema, migrations and relevant tests

Reuse current IDs, tables, queries, mutations, provider policies and queues. Add only missing projections, bindings, immutable snapshots, packets, job metadata and evaluation records.

## 5. Canonical truth and data isolation

The canonical truth remains the existing Project, Story, Character, CharacterLook, Scene, ScenePreset, EnvironmentState, Prop, AssetRevision, Shot, Generation, Knowledge and data-row records.

Never copy them into an AI-only character, scene, asset or knowledge database.

Any new record must reference canonical IDs and revisions. It may represent:

- a binding
- a projection
- an immutable context snapshot
- a Shot Context Packet
- lineage
- a dataset manifest
- a training or evaluation job
- an adapter/model version
- an outbox/durable job record

All retrieval must be project/group/tenant scoped and ACL checked. Project A must never retrieve Project B private material. Do not send material to a provider whose privacy or capability policy does not allow it.

## 6. Project Creative Context service

Build a project-scoped service that composes, without duplicating:

- world rules and creative direction
- current Story revision
- character identities, aliases, relationships and immutable traits
- current and historical CharacterLooks
- skin tone, face shape, hair, costume, accessories and palettes
- scenes, presets and environment states
- props and ownership
- adopted AssetRevisions and approved visual/audio references
- project knowledge and structured database facts
- user locks and confirmed bindings
- previous/current/next shot continuity
- provider/model capabilities
- approval, quota and cost state

Every returned context item must retain source ID, revision, provenance and an explanation of why it was selected.

## 7. Entity binding

Story references must resolve to real IDs rather than remain free-text prompt fragments:

- Character ID
- CharacterLook ID
- Scene/ScenePreset/EnvironmentState ID
- Prop ID
- AssetRevision ID
- Knowledge chunk or data-row ID

Support aliases, renamed entities, same-name ambiguity, confidence, human confirmation, locks, revision, undo and provenance.

High-confidence matches may bind automatically under existing policy. Ambiguous or high-impact matches must create a Proposal. Re-parsing must not overwrite a human-confirmed binding.

Proposal is not a mutation. Only explicit Apply, Adopt or Confirm may change canonical binding.

## 8. Versioned Shot Context Packet

Create an immutable, versioned packet for every generatable Shot. It must include as applicable:

- project and Story revision
- Scene/Shot IDs and revisions
- Character IDs and CharacterLook IDs/revisions
- immutable identity and look constraints
- ScenePreset and EnvironmentState IDs/revisions
- Prop IDs
- reference AssetRevision IDs
- world/style references
- knowledge and data-row citations
- visual description, action, staging, camera and duration
- dialogue, narration, voice, ambience, SFX and music needs
- previous/next shot continuity anchors
- negative constraints and user locks
- provider/model/policy version
- packet schema version
- context fingerprint
- lineage and creation time

Freeze the packet when a generation command is created. Later project changes create a new fingerprint and mark only dependent shots stale. Never mutate historical packets. Historical generations must remain reproducible.

## 9. Story, screenplay and storyboard grounding

Wire Project Creative Context into story.parse and generateStoryboard:

- Prefer existing canonical entities and avoid duplicate Character/Scene/Prop creation.
- Choose the Look appropriate to the scene state.
- Preserve scene time, weather, palette and fixed objects.
- Preserve prop appearance and ownership.
- Ground world facts, relationships and chronology in project knowledge.
- Include approved asset references in each Shot packet.
- Do not overwrite manually refined Shots.
- Produce genuinely different creative-direction candidates, not the same prompt with minor adjectives.
- Record which characters, looks, scenes, props, assets and citations contributed to every result.

The generation path becomes:

Story text → scoped retrieval → entity binding → Proposal for ambiguity → Scene/ShotDraft → frozen Shot Context Packet → consistency preflight → existing generation command/queue/approval/points/provider path → candidate → consistency evaluation → explicit Adopt → targeted staleness/regeneration.

The full flow must be durable, reloadable, retry-safe, idempotent and auditable.

## 10. Consistency before training

First improve consistency using provider capabilities already available:

- approved multi-angle character reference sets
- face/body/skin/hair/costume/accessory constraints
- style and scene references
- previous-frame or continuity conditioning
- provider-supported character/style reference inputs
- control images, deterministic controls or seeds when supported
- active trained adapter when supported

Use a capability-aware provider adapter. Do not send unsupported parameters.

Multi-character shots must preserve identity-to-Look assignment and prevent identity, costume, accessory and skin-tone swapping.

Add post-generation evaluation for identity, Look, palette, scene, prop, semantic and continuity fit. A low-scoring output remains a candidate and must not silently become current. Allow targeted retry only.

## 11. Real consistency training

Training is Phase 4 of the Context Engine, not a separate system. Do not train a foundation model from scratch.

Implement practical project/character-scoped adapter training supported by a real provider, such as a LoRA, identity embedding, visual adapter or provider-specific character consistency model.

Audit the existing provider registry first. Implement:

- a provider-neutral training contract
- at least one production provider adapter
- request, external job ID, callback/polling, retry and cancellation
- durable state and idempotency
- quota, points, cost estimate and approval
- stored adapter/model reference
- inference-time binding through existing provider routing
- evaluation, versioning, Promote and rollback

Tests may mock network calls, but the production path cannot return a fake completed training job. If provider configuration is absent, the normal UI must not show a fake available action.

Do not execute a paid training run without explicit authorization.

## 12. Dataset governance

Only user-owned/licensed and explicitly training-eligible AssetRevisions may be included. Exclude rejected, stale, revoked, watermarked, duplicate, low-quality, identity-wrong or cross-project material.

Create an immutable dataset manifest containing:

- dataset ID/version and project/character/look scope
- AssetRevision IDs and content hashes
- captions/labels and applicable angles
- provenance and rights/consent
- inclusion/exclusion reasons
- train/evaluation split
- dataset fingerprint
- creator and timestamps

A retraining run creates a new manifest. It must not mutate the prior dataset.

Support consent revocation for future training without deleting historical audit evidence. Large weights remain with the provider or existing object storage, not in PostgreSQL.

## 13. Model lifecycle

Training states must include queued, awaiting approval, training, evaluating, succeeded, failed, cancelled and superseded.

Provider callbacks may repeat and must be idempotent. Worker restart must not duplicate jobs, model versions, points or Promote operations.

Training completion never changes the active model automatically.

Required promotion flow:

1. Evaluate against a fixed holdout set.
2. Produce before/after candidates.
3. Compare identity, Look, skin tone, costume and style consistency.
4. Show version, metrics and cost.
5. Require explicit “採用這個一致性版本”.
6. Update the active pointer only after that action.
7. Support rollback without deleting history.

If CharacterLook changes during training, the result must be marked as based on an older revision and cannot auto-Promote.

## 14. Simple UX inside #742

Do not add a top-level page or competing primary CTA.

The existing Story workspace should normally show only concise states:

- 已套用專案設定
- 有 X 項需要確認
- 可加強一致性

The existing generation CTA automatically uses the project context.

Inside the existing Storyboard or Production reveal slot, add a compact source summary such as:

- 3 位角色
- 2 套造型
- 4 個場景
- 8 項素材
- 5 項知識引用

Details open on demand and explain source/binding. Do not fill the first screen with configuration cards.

Place “加強角色一致性” inside the existing Character/Look or Production area. The normal flow is at most:

1. Review the automatically selected assets.
2. Confirm rights, estimated cost and affected scope.
3. Start consistency enhancement.

Normal mode must not require users to understand LoRA, embedding, seed, checkpoint, context fingerprint or provider capability. Put technical details in an advanced drawer/sheet.

At 390px, users must be able to review bindings, inspect sources, generate, diagnose inconsistency, regenerate affected shots, start training, compare versions and Promote. Touch targets are at least 44px and there is no horizontal overflow.

## 15. Five stacked Draft PR phases

### Phase 1 / this PR: Canonical context and prerequisites

Branch: agent/project-creative-context-plan

- Verify and fix still-real #742 prerequisite findings with focused tests.
- Build Project Creative Context service.
- Build entity binding, provenance, ACL and Proposal behavior.
- Add only necessary additive schema.
- Create docs/implementation/project-creative-context-progress.md.
- Continue this existing PR; do not open a duplicate Phase 1 PR.

### Phase 2: Shot packets

Branch: agent/project-context-02-shot-packets

- Build immutable versioned Shot Context Packets.
- Add fingerprints, dependency graph, lineage and targeted stale calculation.
- Bind Story, Character, Look, Scene, Prop, Asset and Knowledge IDs to each Shot.
- Restore state after reload.

### Phase 3: Generation wiring and evaluation

Branch: agent/project-context-03-generation-wiring

- Wire context into story.parse, generateStoryboard, generationCommand, batchGenerate and CreationWorkbench.
- Generation requests must use frozen packets.
- Preserve approval, quota, points, retry and idempotency.
- Add consistency preflight and post-generation candidate evaluation.
- Never silently overwrite current.

### Phase 4: Real consistency training

Branch: agent/project-context-04-consistency-training

- Add immutable dataset manifests and rights/quality gates.
- Add a real provider training adapter and durable job lifecycle.
- Add callback/polling, cost, approval, points, evaluation, versions, Promote, rollback and inference binding.
- Do not perform a paid live run without authorization.

### Phase 5: Simple UX and closed-loop E2E

Branch: agent/project-context-05-simple-ux

- Add compact source/binding summary to existing #742 inline sections.
- Add confirmation cards only for real ambiguity.
- Add the three-step consistency enhancement flow.
- Map result feedback to CharacterLook/Scene/Shot and targeted regeneration.
- Adopt/Reject may influence future dataset eligibility but must never auto-train.
- Complete mobile/desktop E2E and evidence.

All PRs stay Draft. Do not merge them.

## 16. Safety invariants to test

- Project A cannot retrieve Project B data.
- ACL applies to packets, datasets, jobs and adapters.
- Re-parse cannot overwrite a human lock.
- Historical packets are immutable.
- Candidate cannot silently replace current.
- A late provider result after human edits remains a candidate and shows conflict.
- Partial failure preserves successful siblings.
- Retry and callback replay cannot duplicate jobs, points or model versions.
- Worker restart restores the real state.
- Revoked assets cannot enter a new training run.
- Look changes stale only dependent Shots.
- Prop or knowledge changes do not rebuild unrelated Shots.
- Promote is a human action and rollback preserves history.
- Missing provider configuration cannot expose a fake train action.
- Paid provider calls remain blocked without authorization.

## 17. Progress and interruption recovery

Maintain docs/implementation/project-creative-context-progress.md with:

- task sources and #742 merge SHA
- base branch/SHA
- current phase and checklist
- branch/PR links
- last successful commit
- migrations and compatibility
- tests with PASS, BASELINE_EXISTING_FAILURE, INTRODUCED_BY_THIS_PR or BLOCKED_BY_ENVIRONMENT
- provider/secret status
- whether any paid provider was called
- exact next action and human blocker

After each verifiable segment: update journal, inspect diff, run targeted tests, commit clearly, push, update Draft PR body, then continue.

On interruption, checkpoint, commit and push when possible. Resume from the first unfinished checkbox; never restart from scratch or create duplicate PRs.

## 18. Validation

For each phase run relevant targeted unit, service, router, PostgreSQL, client, reload, retry and conflict tests, then repository-available:

- npm run typecheck
- npm run check:boundaries
- npm run check:ui-primitives
- npm run check:hooks
- npm test
- npm run test:client
- npm run build

For schema changes run fresh apply, existing-database upgrade, migration safety, drift and compatibility checks.

E2E must cover:

1. Create canonical Character, Look, Scene, Prop, assets and knowledge.
2. Write Story and bind real IDs.
3. Generate Storyboard and inspect Shot Context Packets.
4. Generate a candidate and show its sources.
5. Change a Look and stale only dependent shots.
6. Regenerate only affected shots.
7. Build a governed dataset manifest.
8. Execute a mocked provider contract through the real durable job path.
9. Process duplicate callback safely.
10. Compare model versions and explicitly Promote.
11. Reload and verify persisted truth.

Save actual viewport evidence for 390, 430, 768, 1280 and 1440 under docs/evidence/project-creative-context/.

## 19. Prohibited actions

- Rebuilding or bypassing #742 Story workspace
- Restoring four-stage primary navigation
- Creating parallel character/scene/asset/knowledge truth
- Dumping the whole database into a prompt
- Cross-project private retrieval
- Unconsented face/model training
- Fake buttons, fake progress or setTimeout production jobs
- Automatic model Promote
- Silent current-pointer overwrite
- Weakening or skipping tests
- Exposing secrets
- Paid provider invocation without authorization
- Unrelated homepage/chat/admin/auth/scheduling rewrites
- auto-merge, force push or git reset --hard

Stop only for irreversible deletion, destructive migration without compatibility, a genuinely required absent secret with no safe implementation path, a paid live training/generation action, external publication, or truly contradictory confirmed requirements.

## 20. Definition of Done

Complete only when:

- #742 single Story workspace remains intact.
- Project characters, looks, scenes, props, assets, knowledge and structured rows actually ground screenplay/storyboard/generation.
- Story mentions bind to canonical IDs.
- Every generatable Shot has a versioned reproducible packet.
- Generation uses frozen packets and records source lineage.
- Users can inspect what project information was used.
- Reference conditioning and post-generation consistency evaluation work.
- Changes affect only dependent shots.
- Targeted regeneration works.
- Dataset rights, provenance, versions and fingerprints exist.
- At least one real production training adapter is wired.
- Training jobs are durable, recoverable, idempotent and cost/approval aware.
- Models require explicit Promote and support rollback.
- No second canonical database or fake flow exists.
- ACL, revision, quota, approval, points, idempotency, lineage and current-pointer invariants remain.
- 390px mobile completes the primary flow.
- All introduced failures are fixed.
- Five stacked Draft PRs, progress journal and evidence are complete.

Final report only:

1. completion summary
2. five PR links and dependency order
3. commit SHAs
4. schema/migrations
5. actual tests and classifications
6. mobile evidence
7. real training-provider integration status
8. whether any paid provider was called
9. real remaining limits
10. required human review, secret, payment or Promote decisions
