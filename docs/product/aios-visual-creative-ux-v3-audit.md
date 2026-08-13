# Aios Visual Creative UX v3 — CURRENT audit and architecture

Base: `1a11a5b0d5550f6fb8f63aa5f99b39dd488eade3` (GitHub default branch at implementation start; merge commit for #722).

## Fresh-eye CURRENT audit

1. v2 truth matches #722: StoryboardStage owns the artwork-first surface; VisualChoiceTray is the one contextual choice inspector; SceneStudio owns generation/version comparison; `generations + assets + scenes.assetId` is version/current truth.
2. Look was append-only in v2 (`appendBoundId`). v3 replaces an existing Look owned by the same Character, preserves other Characters' Looks, adds when that Character had none, and refuses a Look whose Character is not in the Shot.
3. The schema intentionally permits multiple Character, ScenePreset and Prop ids. v3 keeps multi-Character and multi-Prop. In this inspector a normal Shot is treated as one environment, so choosing Scene replaces `scenePresetIds` with one id. Other existing editors retain their advanced multi-scene behavior.
4. `worldview.styles` is not a scalar. CURRENT defines `[primary look, compatible texture?]`, and generation injects that projection. v3 uses the existing family-aware selection helper; it does not write `{styles:[selected]}`.
5. Existing `scenes.generateInto` is unsafe for variants because completion automatically advances `scenes.assetId`. v3 adds one orchestration mutation over the same command and marks its jobs as candidates that preserve the pointer.
6. Three variants cost three independent model jobs. UI shows their aggregate estimate; version rows show actual net points after refunds.
7. Approved Shots are omitted from Visual Choice writes. Apply snapshots exact Shot ids. Shot field/card writes carry the existing `rev + baseline` contract so conflicting concurrent edits fail or field-merge instead of silently overwriting.
8. At 390 px the inspector remains one bottom-sheet surface, Mixed distributions truncate safely, controls are at least 44 px, and Compare becomes a full-screen single-column surface without hover dependency.

## Semantic rules

| Choice | Natural operation |
| --- | --- |
| Character | Add when absent; clicking a value present in every writable target removes it. In a mixed batch, a partially present value is unified (kept where present, added where absent). |
| Look | Replace the same Character's Look; add if that Character has no Look; remove only when present in every writable target. |
| Scene | Replace with the selected single environment; selecting the same sole Scene is Keep. |
| Prop | Add/Remove with the same mixed-batch unification rule as Character. |
| Asset | Replace the Shot's current visual pointer. |
| Starter direction | Replace only the structured fields carried by the preset; unrelated direction fields are merged and preserved. |

The UI computes and displays Add / Remove / Replace / Keep / Unify before Apply. It never asks creators to reason about ids.

## Mixed State

Mixed State is a read-only projection over the current selected Shot rows. Each family gets a canonical value distribution, e.g. `夏季服裝 V4 ×3・夏季服裝 V3 ×2`; more than one value renders `MIXED`. There is no mixed-state table, local candidate store, or second persistence truth. Apply freezes exact ids at click time, skips approved rows, and uses the writable snapshot to decide whether a click means remove-everywhere or unify-present.

## Starter Pack asset seam

Every stable semantic preset resolves to `/creative-choice/starter-v1/<family>/<preset-id>.webp` with version, alt text, description-derived accessible label, aspect and a semantic SVG/swatch fallback. The public manifest documents the contract. Designers can add/replace images without changing React or preset ids. Missing images render the fallback; no runtime generation request or Gemini cost is involved.

## Generate Variants architecture

```text
SceneStudio Generate 3 Variants
  -> scenes.generateVariants (2–4 bounded ids)
  -> Promise.allSettled
  -> executeGenerationCommand x 3
     -> existing project state / ACL / Policy Engine
     -> existing estimate / approval threshold / quota reservation
     -> existing provider routing and refund state machine
  -> existing generations + assets
  -> scenes.versions projection
  -> Compare 2–3 successful real assetIds
  -> setVisualFromAsset (explicit Adopt)
  -> scenes.assetId current pointer
```

`preserveScenePointer` is internal metadata stored inside existing `generations.params` and stripped before provider submission. It is retained by retry. It is operation policy, not a new version truth. Normal `generateInto` behavior is unchanged.

Each slot uses a stable UUID as the generation primary key. A timeout/retry with the same batch ids replays existing rows and cannot reserve or charge twice. Launch and later provider failures are projected independently; successful siblings remain comparable. Awaiting-cost-approval is not reported as settled.

## Style semantics

Style cards explicitly edit project Style. Starter looks are registered in the existing media-family table, so choosing a new same-family primary preserves the compatible texture descriptor; an incompatible texture is deliberately removed because it would not be injected correctly. The UI shows the combined project label. A one-Shot exception belongs in the existing natural-language Shot prompt and is labelled as temporary, so it does not pollute project Style or require a new schema.

## Aios proposal seam

StoryboardStage already publishes exact single/multi-Shot focus through `registerAssistantFocus`. Aios proposals therefore remain additive: the existing Agent can read the selection and propose directions, but only the explicit Visual Choice Apply path changes Shot truth. v3 does not rebuild Agent or add an autonomous apply channel.

## Verification and evidence

- Baseline before edits: typecheck PASS; v2 targeted client tests PASS (46); CURRENT Vite started. Authenticated data could not load locally because `DATABASE_URL` is not configured.
- Targeted v3: semantic/Mixed/fallback/Style/Variants/partial-failure/idempotency/concurrency/SceneStudio tests PASS.
- Full client suite: PASS — 206 files, 1,821 tests.
- Full server/shared suite: 261 files and 2,838 tests PASS; one pre-existing Windows-only path assertion fails in `server/services/gemini.test.ts`. The identical failure was reproduced from an untouched detached worktree at base `1a11a5b0d5550f6fb8f63aa5f99b39dd488eade3` (10 PASS, 1 FAIL in that file).
- Build and static gates: `npm run typecheck`, `npm run build`, `npm run check:boundaries`, `npm run check:hooks`, and `npm run check:ui-primitives` PASS.
- Browser evidence: `docs/evidence/visual-creative-ux-v3/` (desktop and 390 px Mixed + Compare/partial-failure).
- 390 px measurement: viewport 390, document scroll width 390; visible interactive controls were all at least 44 px.

## Known limitations

- The public Starter Pack begins with the stable path/fallback contract; missing bitmap entries intentionally show the semantic diagrams/swatches until product art is dropped into the documented paths.
- Variants use one selected model and prompt/context per batch. Model-vs-model comparison remains the existing benchmark feature, not this button.
- Cost-approved jobs can wait indefinitely for a leader; the batch honestly stays “waiting for cost approval” rather than fabricating completion.
- Local browser QA used a bounded visual harness because this checkout has no database credentials. Actual component behavior is covered by client/server tests; the harness is not shipped.
