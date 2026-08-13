# Aios Visual Creative Choice System — Implementation Contract

> Status: IMPLEMENTATION_REQUIRED
> Date: 2026-08-13
> Branch: `feat/visual-creative-choice-system`
> Scope: make creative materials directly visible, selectable, comparable, reusable, and actionable for end users.
> This is **not** a visual skin for the assistant and **not** a collection of decorative mockups.

## 0. Product goal

Aios must reduce prompt-writing friction by turning common creative decisions into visual choices backed by real project entities and persisted references.

The target experience is:

```text
AI / existing project state
→ visual candidates
→ user selects / compares / adopts
→ selected entity ids become exact generation references
→ Aios executes against the chosen scope
→ result is versioned and written back to the project
```

The user should be able to create by **seeing and choosing**, not only by describing everything in text.

## 1. Non-negotiable principles

1. Every card shown as actionable must map to a real entity, preset, asset, version, or deterministic command payload.
2. Do not build a second selection store. Extend the existing assistant/page selection context.
3. Do not create decorative cards that cannot affect generation or project state.
4. Do not silently overwrite accepted/current versions.
5. User-visible choices must freeze exact ids before long-running work begins.
6. AI-generated candidates remain candidates until adopted, unless the user/autonomy policy explicitly allows automatic adoption.
7. Mobile interaction is first-class; cards must remain usable at ~390px.
8. Visual choice is a control surface for the existing Creative OS, not a parallel creative runtime.

## 2. Core visual choice families

### 2.1 Character Choice Cards

Show one card per character candidate/reference with:

- preview image
- character name
- current version / reference status
- active look/outfit
- consistency readiness
- usage count / affected shots when cheaply available
- selected / candidate / locked state

Actions:

- select as current character reference
- compare versions
- open looks
- generate missing reference views
- apply to selected shots
- lock/unlock as reference according to permissions

### 2.2 Look / Outfit Cards

A visual look is not a text note only. It must be selectable and linked to the character.

Show:

- outfit preview
- look name
- color/material summary
- current/alternate state
- affected shots

Actions:

- adopt look
- apply to selected shots
- generate alternate look
- compare old/new
- show downstream stale impact before destructive/current-pointer changes

### 2.3 Action / Pose Cards

Provide a reusable visual action library.

Examples:

- standing neutral
- walking
- running
- looking back
- pointing
- holding map
- sitting
- jumping
- reaching
- defensive pose

Each action card must contain a stable `actionId` or stable preset key, not only a label.

The implementation may start with curated developer-owned presets and later add user/project-generated action sets.

Action cards should support:

- global generic preview
- character-specific preview when available
- intensity / motion class
- single-shot apply
- multi-shot apply

### 2.4 Expression Cards

Examples:

- neutral
- subtle smile
- happy
- surprised
- worried
- angry
- sad
- determined
- embarrassed
- focused

Expression cards should preferably reuse the current character reference so the preview reflects the actual character when a generated preview exists.

The underlying choice must be represented by a stable expression preset or persisted project entity.

### 2.5 Scene / Environment Cards

Show visual scene references/presets with:

- scene image
- scene name
- environment identity
- current time-of-day variant
- current weather/atmosphere variant
- lock/reference state

Actions:

- select scene reference
- apply to selected shots
- open lighting/time variants
- create new variant without replacing the source

### 2.6 Lighting / Time / Atmosphere Cards

Provide fast visual variants such as:

- morning
- daylight
- overcast
- sunset
- blue hour
- night
- rain
- fog
- warm interior
- cold interior

These cards must resolve to real structured generation inputs/presets, not only append uncontrolled prose.

### 2.7 Camera / Shot Language Cards

Provide visual camera-language choices:

- extreme close-up
- close-up
- medium close-up
- medium
- full body
- wide
- establishing
- over-the-shoulder
- POV
- low angle
- high angle
- top-down
- tracking
- profile
- back view

Each card must map to a structured camera/shot preset so the same choice can be:

- previewed
- persisted
- reapplied
- included in generation context
- displayed in the Shot Card

### 2.8 Style Cards

Style choice must become visual and project-aware.

Examples are product presets, not provider names:

- healing picture-book
- cinematic animation
- colored storyboard
- rough storyboard
- soft watercolor
- graphic comic
- cinematic realism

Style Cards must support:

- preview
- selected project style
- per-shot override where allowed
- reference image linkage
- provenance/version

Do not expose raw model ids as the main style UX.

### 2.9 Prop / Important Object Cards

Important objects must be visually selectable so continuity does not depend on text memory.

Show:

- reference preview
- name
- owner/associated character when known
- material/color summary
- continuity/reference readiness

Allow apply/remove on selected shots.

### 2.10 Storyboard Variant Cards

A generation request should be able to return multiple useful storyboard candidates.

A variant card should show:

- thumbnail
- short semantic label, e.g. `情緒特寫`, `資訊清楚`, `動作感強`
- generation/provider metadata in secondary detail
- current/candidate/rejected state
- approximate point cost when useful

Actions:

- adopt
- compare
- regenerate from this version
- edit selected version
- send to video

### 2.11 Compare / Adopt UI

Provide a first-class comparison surface for 2–4 candidate versions.

Required:

- same-size visual comparison
- differences as concise structured metadata where available
- adopt one version
- keep alternates
- reject candidate without deleting lineage
- return to previous current version

Avoid forcing the user to open an asset library and manually infer which file is newer.

## 3. Visual choice composition

The most useful UX is not isolated card galleries. Aios should support composable choices:

```text
Character
+ Look
+ Expression
+ Action
+ Scene
+ Lighting
+ Camera
+ Style
+ Props
→ Shot Context Pack
→ Preview / Generate / Apply
```

The user can therefore build a shot visually.

Example:

```text
娜美
+ 夏季服裝 V4
+ 驚訝
+ 回頭
+ 海灘
+ 黃昏
+ 中景
+ 治癒動畫
+ 藏寶圖
→ Apply to Shot 08
```

Aios must convert the visible choices into exact ids/preset keys before execution.

## 4. Quick Choice Tray

On Storyboard/Shot selection, open a contextual choice tray rather than sending the user through many settings pages.

Suggested sections:

```text
角色 | 動作 | 表情 | 場景 | 光線 | 鏡頭 | 風格 | 道具
```

Behavior:

- one selected Shot: apply immediately or preview depending on action risk
- multi-selected Shots: show target count and freeze exact Shot ids
- no selection: choice can become default/project-level only where semantically valid

Never guess the target of `這個` or `第三個` after selection has changed.

## 5. Smart Suggestions

Aios should suggest visual choices from current context.

Examples:

- a character is in this Shot but has no active look → surface Look Cards
- a Shot has narration but no visual direction → surface Camera/Action cards
- adjacent shots have sunset lighting → surface matching sunset card first
- current scene has a locked prop → surface that prop as preselected
- current visual has multiple candidates → surface Compare/Adopt before regenerating

Suggestions must come from project truth and current selection, not generic random cards.

## 6. Developer-seeded visual libraries

The website should ship with curated starter visual libraries so first-time users immediately see and understand available choices.

Recommended developer-owned starter packs:

### Action pack

20–40 common actions/poses.

### Expression pack

10–16 common expressions.

### Camera pack

12–20 shot/camera compositions.

### Lighting pack

8–12 lighting/time-of-day conditions.

### Style starter pack

6–12 visually distinct product-level style presets.

### Composition pack

optional rule-of-thirds / centered / silhouette / foreground-frame / leading-lines presets.

These starter assets can be produced by the developer using Adobe/Gemini/etc., then committed or uploaded as versioned site assets.

They must include machine-readable manifest metadata.

## 7. Visual preset manifest

Do not hardcode file paths throughout React components.

Create one manifest/source of truth, e.g.:

```ts
interface VisualChoicePreset {
  id: string;
  family: "action" | "expression" | "camera" | "lighting" | "style" | "composition";
  label: string;
  previewAsset: string;
  description?: string;
  promptFragment?: string;
  structured?: Record<string, string | number | boolean>;
  tags?: string[];
  version: number;
}
```

Rules:

- stable ids
- versionable
- localized labels
- preview asset path separated from semantic payload
- semantic payload may evolve without changing the user-facing preview location
- no provider/model-specific fields in the top-level user choice unless unavoidable

## 8. Real project entities vs developer presets

Aios must distinguish:

### Developer preset

Reusable semantic visual choice, e.g. `action.running.v1`.

### Project entity

Project-specific reference, e.g. a particular character, look, scene or prop.

### Generated candidate

A generated visual version attached to a Shot/entity.

The UI may show them together, but data semantics must not blur them.

## 9. Backend resolution

Before any write/generation:

```text
visual selection
→ resolve preset ids + project entity ids
→ validate ownership / ACL
→ freeze target Shot ids
→ build generation/context input
→ execute through existing Agent/generation path
→ read-back verify
```

Client-provided labels/previews are never authoritative ids.

## 10. Integration with Creative Bible

Visual Choice UX should become the easiest way to populate and reuse the Creative Bible.

Character/Scene/Look/Prop cards should expose:

- reference image
- reference readiness
- selected/current version
- missing reference warning
- `使用於 N 鏡` when available

A user should not need to understand the term `reference compiler` to benefit from it.

## 11. Integration with Storyboard

Storyboard remains the main production surface.

Each Shot Card should make the current choices visible at a glance:

```text
[thumbnail]
Shot 08
娜美 · 夏季 V4
驚訝 · 回頭
黃昏海灘
中景
```

Clicking one chip opens that family of visual choices.

Example:

- click `驚訝` → Expression Cards
- click `中景` → Camera Cards
- click `黃昏` → Lighting Cards
- click character → Character/Look Cards

This creates direct manipulation instead of reopening prompt forms.

## 12. Integration with Aios Agent

Aios can still accept natural language.

Example:

```text
「這三鏡都更有冒險感，但人物不要換。」
```

Aios may respond by opening a visual proposal set:

- Action option A/B/C
- Camera option A/B/C
- Lighting option A/B

The user can accept visually instead of rewriting the prompt.

For high-autonomy mode, Aios may choose cards automatically, but the final chosen ids must still be persisted and visible.

## 13. Candidate generation strategy

Do not generate expensive custom previews for every possible choice by default.

Use tiers:

### Tier 1 — developer-seeded preview

Instant; no user cost.

### Tier 2 — project-personalized preview

Generate only when user opens/requests personalized character/action/expression previews.

### Tier 3 — final production generation

Uses the selected visual choices to create the actual project asset.

This avoids spending points just to populate menus.

## 14. Performance requirements

- lazy-load offscreen previews
- responsive thumbnails
- avoid loading full-resolution media for choice grids
- virtualize only when card count is large enough to justify it
- cache immutable developer preset assets aggressively
- use one bounded projection/query for context-specific choices where possible
- avoid N+1 per-card backend requests

## 15. Accessibility

Every visual card must have:

- readable text label
- selected state not communicated by color alone
- keyboard selection
- visible focus
- usable screen-reader name
- minimum ~44px interactive target on mobile

Images are supporting information, not the sole control label.

## 16. Mobile UX

At ~390px:

- use a horizontal family tab row or bottom sheet
- use 2-column cards where visual detail remains readable
- comparison can become swipe/stacked instead of 4 columns
- sticky target scope remains visible: `已選 3 鏡`
- one-tap `套用` / `比較` / `生成` actions
- no horizontal page overflow

## 17. Suggested component families

Names may adapt to current repo conventions:

```text
VisualChoiceTray
VisualChoiceFamilyTabs
VisualChoiceCard
CharacterChoiceCard
LookChoiceCard
ActionChoiceCard
ExpressionChoiceCard
SceneChoiceCard
LightingChoiceCard
CameraChoiceCard
StyleChoiceCard
PropChoiceCard
StoryboardVariantCard
VariantCompareSheet
SelectionScopeBar
ChoiceImpactPreview
```

Prefer extension of existing Storyboard/ResourceDock/UI primitives over parallel component systems.

## 18. Suggested shared/backend modules

Only add when existing modules do not already own the responsibility:

```text
shared/visualChoicePresets.ts
shared/visualChoiceTypes.ts
server/services/visualChoiceResolver.ts
server/services/visualChoiceSuggestions.ts
```

A resolver must validate and translate visual choices into existing generation/scene inputs.

## 19. Persistence rules

Developer presets can live in source-controlled manifests/assets.

Project-specific choices must use existing project entities wherever possible.

Only add persistence when a real semantic gap exists.

Potential structured fields, if CURRENT schema has no equivalent, must be additive and migration-reviewed:

```text
actionPresetId
expressionPresetId
cameraPresetId
lightingPresetId
stylePresetId
```

Before adding columns, audit whether these already belong in existing scene metadata/preset tables.

Do not hide production-critical semantics only inside arbitrary prompt text.

## 20. Visual choice impact preview

Before applying a change to multiple accepted/generated shots, show the impact:

```text
套用「黃昏」到 6 鏡

2 鏡只更新尚未生成設定
3 鏡的圖片會變 stale
2 支依賴舊圖片的影片會變 stale
1 鏡已通過審核，不會自動修改
預估重新生成：12 點
```

Reuse #707 dependency/stale semantics when available. If #707 is not yet merged, isolate the interface and do not duplicate its runtime.

## 21. Relationship to PR #707

This feature is a separate PR because it is a distinct product/UI capability.

However it must be designed to converge with #707:

- #707 owns Creative OS runtime/provider/stale/provenance direction
- this PR owns user-facing visual selection/manipulation of creative inputs/candidates

Do not copy #707 provider adapters, Agent runners, model routers, lineage systems or stale engines.

If #707 merges first, rebase/sync and consume its new interfaces.

If this PR lands first, expose additive interfaces that #707 can consume later.

## 22. Required Golden Flows

1. User selects one Shot → opens Action Cards → picks `回頭` → Shot stores/resolves the semantic choice → generation uses it.
2. User selects 3 Shots → chooses `黃昏` → exact 3 Shot ids are frozen → impact is shown → only those Shots change.
3. User opens Character → picks Look V4 → affected Shot list is shown → current/approved Shots are protected.
4. User chooses Scene + Camera + Expression visually → Aios generates a storyboard candidate using those exact choices.
5. Aios generates 3 storyboard variants → user compares → adopts V2 → V1/V3 remain traceable candidates.
6. User changes selection while long work is running → original frozen target remains unchanged.
7. User returns on mobile → same adopted choices/current versions are visible.
8. User has no custom references yet → developer-seeded cards still provide useful zero-cost starter choices.
9. Invalid/stale/deleted project reference → card shows unavailable and cannot silently generate with a different entity.
10. User asks in natural language → Aios can present suggested visual cards as a proposal before execution.

## 23. Required tests

At minimum:

```text
visual preset manifest validation
stable preset ids
choice resolver ACL/ownership
selection freeze
multi-shot targeting
choice → generation payload mapping
current/candidate/adopt behavior
approved-shot protection
invalid/deleted reference behavior
impact projection
mobile interaction
keyboard/accessibility selection
no horizontal overflow at ~390px
```

Plus repo-wide required validation:

```text
npm run typecheck
npm test
npm run test:client
npm run build
npm run check:boundaries
npm run check:hooks
npm run check:ui-primitives
npm run scan:agent-integrity
```

## 24. Implementation order

```text
1. Audit CURRENT scene/preset/card persistence and existing Storyboard/ResourceDock components
2. Add visual preset manifest + validation
3. Add shared visual-choice contract and resolver
4. Character / Look / Scene / Prop choice cards from real entities
5. Developer-seeded Action / Expression / Camera / Lighting / Style packs
6. Contextual VisualChoiceTray in Storyboard
7. Multi-select + frozen target scope + impact preview
8. Storyboard variant compare/adopt
9. Aios visual proposal integration
10. Mobile/accessibility/performance
11. Golden Flow + failure testing
```

## 25. Ready Gate

The PR remains Draft until a non-technical user can complete this flow without writing a detailed prompt:

```text
選 3 個 Shot
→ 選角色/服裝
→ 選動作
→ 選表情
→ 選場景
→ 選黃昏
→ 選鏡頭
→ 選風格
→ 看預估影響
→ 套用
→ 產生 3 個分鏡候選
→ 視覺比較
→ 採用其中一個
→ 做成影片
```

The chosen visual cards must correspond to real persisted/project-resolved semantics and the generated result must remain versioned and traceable.

**Do not auto-merge. Do not force-push.**
