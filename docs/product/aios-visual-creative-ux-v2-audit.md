# Aios Visual Creative UX v2 — CURRENT audit and architecture

Baseline: `a10100f6336654374fccf4a28df808beced7b873` (`claude/healing-migration-ai-os-erewp2`, current GitHub default at implementation start).

## CURRENT UX audit

1. **Where users operate the work:** StoryboardStage is the primary production surface. ShotCard owns the visible artwork and direct Shot fields; SceneStudio owns generation, refinement, version history, and the current visual pointer. ResourceDock and VisualChoiceTray previously competed with that surface in a permanent right rail.
2. **Real visual-choice data:** `scenes.characterIds`, `lookIds`, `scenePresetIds`, `propIds`, `camera`, `performance`, `action`, `prompt`, `assetId`; project Character/CharacterLook/ScenePreset/Prop/Asset records and their reference assets; project `worldview.styles`; `generations + assets + scenes.assetId` for versions/current.
3. **Preset-only data:** action, expression, camera, lighting, composition, and generic style seeds in `shared/visualChoicePresets.ts`. They are starter vocabulary, not a product whitelist.
4. **Prompt fragments:** every #710 starter has `promptFragment`, but no independent prompt-fragment persistence existed. Camera/performance/action become generation input because they persist to Shot fields; Style did not.
5. **False-success UI:** #710 Style said it was remembered while writing no durable field. Reload discarded it. This is replaced with an explicit adoption into existing `projects.worldview.styles`.
6. **Choices that reach generation:** Shot camera/performance/action through `buildShotContextPrompt`; Shot natural-language prompt through `sceneVisualPrompt`; project Character/Look/Scene/Prop through generationCore/card anchors; project Style through generationCore's worldview visual injection.
7. **Poor mobile interactions:** a 260px sticky Tray, a separate 240px ResourceDock, 4px-high family controls, and no dedicated compare surface. These were desktop rails compressed into a phone.
8. **Information competition:** yes. ResourceDock + VisualChoiceTray + Shot details + Agent could all be visible alongside the artwork. V2 uses one contextual creative inspector; full asset/settings management remains on-demand via existing project links.
9. **Can users read Shot CURRENT STATE:** not in #710. ShotCard showed at most four entity chips, omitting action, expression, lighting, camera, and style. V2 derives eight visible state families from persisted data.
10. **Can users compare candidate/current/approved:** data support existed, first-class UX did not. SceneStudio listed versions and could set current, but offered no 2–3-up compare surface. V2 compares the existing `scenes.versions` projection and adopts via existing `setVisualFromAsset`.

## What remains from #710

- stable preset ids
- semantic families
- structured payloads
- prompt fragments as manifest metadata
- versioned manifest
- `mapPresetToShotPatch` and merge-without-wiping behavior

## What v2 replaces

- emoji as the primary preview (emoji remains a fallback only)
- one generic grid shape for every creative decision
- permanent `frozenIds` UI lock
- false Style success
- starter presets standing in for project Character/Look/Scene/Prop
- two permanent right-side panels
- version list without direct comparison

## Architecture

```text
Project truth + Shot truth
        ↓
Current Creative State (read-only projection)
        ↓ click one family
Project choices OR starter manifest
        ↓ choose candidate
Apply snapshots exact selected Shot ids
        ↓
existing scenes.update / scenes.setCards / projects.updateWorldview
        ↓
existing generationCore + card anchors + worldview injection

generations + assets + scenes.assetId
        ↓
scenes.versions → Compare → setVisualFromAsset (Adopt)
```

There is no second selection store, version truth, or generation pipeline. Preview metadata is provider-agnostic (`image`, `composition`, `pose`, `expression`, `swatch`, `fallback`); replacing starter art does not change React or semantic ids.

## Persistence and safety

- Structured starter choices persist to existing Shot fields.
- Style persists to `worldview.styles`, which existing generationCore reads.
- Natural-language refinement persists to the existing Shot prompt and coexists with structured choices/references.
- Apply snapshots exact ids at click time; selection remains live immediately afterward.
- Batch creative edits skip `reviewStatus === "approved"` Shots and report the skip.
- Compare reads real `scenes.versions`; Adopt writes the real current pointer; alternate candidates are retained.
- Asset previews lazy-load; videos never autoplay; project queries are bounded and shared at panel scope, not per card.

## Known limitations

- Starter action/expression previews are lightweight SVG diagrams, not character-personalized generated thumbnails yet. The manifest seam supports replacing them.
- Style adoption is project-level because CURRENT has a durable project style truth but no reviewed per-Shot style-override field.
- Multi-shot impact uses CURRENT review/current-asset facts. It intentionally does not invent a second dependency graph.
- “Generate / compare variations” opens CURRENT SceneStudio generation; it does not add a new multi-candidate backend endpoint.

## Fresh-eye review

### 1. Creator who does not understand prompts

- Current state is visible before controls.
- Each state item directly opens the relevant visual decision.
- Camera/action/expression/lighting have visual diagrams or swatches; text remains a supporting label.
- Natural language is optional and placed after visual selection.

### 2. Professional creator

- Presets do not constrain order or require a wizard.
- Project references outrank generic vocabulary.
- Free text remains fully editable and combines with structured choices.
- Real candidate versions remain available after adopting one.

### 3. Engineering reliability

- Every CURRENT badge is derived from server-backed data.
- Style no longer claims success without a durable write.
- Version comparison/adoption reuses existing asset/version truth.
- Reload reads Shot/project/current-pointer state again; no local candidate version system exists.

## Browser evidence

The production components were exercised in Chromium with a bounded local data harness that projected the same persisted Shot/project/version shapes. The harness itself is not shipped; these review artifacts are.

| View | Desktop | 390 px mobile |
| --- | --- | --- |
| Current State + visual choices | [desktop-current-state.png](evidence/visual-creative-ux-v2/desktop-current-state.png) | [mobile-390-current-state.png](evidence/visual-creative-ux-v2/mobile-390-current-state.png) |
| Real version Compare / Adopt | [desktop-real-version-compare.png](evidence/visual-creative-ux-v2/desktop-real-version-compare.png) | [mobile-390-real-version-compare.png](evidence/visual-creative-ux-v2/mobile-390-real-version-compare.png) |

Measured evidence:

- desktop viewport `1440`, document scroll width `1440`
- mobile viewport `390`, document scroll width `390`
- mobile Current State control `54.39px`, family control `44px`, sticky Apply control `44px`
- compare modal has its own keyboard focus trap and Escape/close behavior
- visual options retain accessible labels, selected state, visible focus state, and supporting text

The browser pass also exposed an existing render-loop risk in `SceneAnnotationLayer`: its layout effect re-measured and set state after every render when a real image was present. The effect is now dependency-scoped while the existing `ResizeObserver` continues to handle subsequent media/layout changes.

## Verification record

- `npm run typecheck` — PASS
- targeted Visual Creative + SceneStudio tests — PASS (`46` tests)
- shared manifest/current-state/generation-context tests — PASS (`11` tests)
- `npm run test:client` — PASS (`204` files, `1811` tests)
- `npm run build` — PASS
- `npm run check:boundaries` — PASS (`1005` files, `11` allowlisted)
- `npm run check:hooks` — PASS
- `npm run check:ui-primitives` — PASS (`0` bare-class violations)
- `npm run scan:agent-integrity` — `BLOCKED_BY_LOCAL_ENVIRONMENT` because no `DATABASE_URL` is configured
- `npm test` — one `BASELINE_EXISTING_FAILURE`: the Windows-path assertion in `server/services/gemini.test.ts` reports that `clientDir` does not exist. The exact test was reproduced in a detached, unmodified worktree at baseline SHA `a10100f6336654374fccf4a28df808beced7b873` (all other repository tests passed).
