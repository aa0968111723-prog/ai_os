# Aios Creative OS — Code-level Implementation Blueprint

> Status: IMPLEMENTATION_REQUIRED
> Date: 2026-08-13
> PR: #707
> Branch: `feat/aios-gemini-omni-creative-agent`
> Scope: **production implementation**, not ideation, not mockup, not Deep Research product work.
> Companion contracts:
> - `docs/product/aios-gemini-omni-creative-agent.md`
> - `docs/product/aios-visual-creative-workspace-implementation.md`
> - `docs/product/aios-creative-os-comprehensive-audit-2026-08.md`

---

## 0. Why this document exists

The other contracts define **what Aios must become**. This document defines **how to implement it in this repository without creating parallel runtimes or corrupting existing truths**.

The end state is not “Gemini buttons”. It is:

```text
User intent / selection
→ current page + project context
→ durable creative goal
→ planner/orchestrator
→ capability applicability
→ context/reference compiler
→ model policy/router
→ canonical generation command
→ provider adapter
→ storage + generation + asset + scene binding
→ read-back verification
→ continuity/stale projection
→ existing timeline / delivery
→ visual workspace + execution receipt
```

Aios remains the product/runtime. Gemini is one provider family.

---

# 1. Current repository facts that implementation MUST preserve

These are verified against the current default branch after #706. Do not replace them with cleaner-looking parallel systems.

## 1.1 Durable Agent runtime already exists

`server/services/agentRunner.ts` already provides:

- background execution after page close
- DAG execution
- advisory-lock protection
- persisted `steps`
- `generationId` idempotency placeholders
- non-generation `effectId` idempotency
- zombie recovery
- bounded parallel generation starts
- stop / waiting / approval behavior
- stale revision guard for edit steps
- agent event recording

Therefore #707 MUST NOT add `creativeAgentRunner`, `geminiRunner`, or another task DB.

## 1.2 Generation side-effect front door already exists

`server/services/generationCommand.ts` is the canonical write entry and already re-checks:

- project state
- group/project access
- policy engine
- generation core

All Agent/Gemini generation must enter here or an equivalently guarded existing core path. No direct `assistant.ts → Gemini` path.

## 1.3 Generation preparation is already sophisticated

`server/services/generationCore.ts` already owns:

- project/worldview injection
- character/scene/prop/look anchors
- continuity snapshot freezing
- reference URL resolution
- prompt budget warnings
- model contract health
- source asset validation
- quota/billing integration
- result persistence/finalization behavior

The main architectural gap is **provider abstraction**, not a new generation pipeline.

## 1.4 Generation persistence already has useful extensibility

`generations` already stores:

- `requestId`
- `params` JSON
- `sceneId`
- `sceneRole`
- card ids
- `continuitySnapshot`
- `agentRunId`
- result/error/cost fields

Use `params` for **namespaced internal provider runtime metadata** when possible before adding columns.

## 1.5 Asset lineage already exists

`asset_revisions` already models:

```text
child asset → source asset
```

Do not create a second lineage table for generated edits unless an actual missing cardinality is proven.

## 1.6 Selection awareness already exists

`client/src/lib/assistantContext.ts` already supports:

- page
- project
- entity type/id
- `selectedEntityIds`
- active tab
- cleanup when context changes

Do not create another selection store.

## 1.7 Truthful event stream already exists

`shared/agentEvents.ts` explicitly forbids fake progress and already supports:

- tool/action start/progress/complete/fail
- source reads
- verification events
- waiting states
- reconnect by run id

Creative execution visualization MUST project from this plus generation truth.

## 1.8 Creative truths already exist

Reuse:

- `shared/shotCompletion.ts` for current per-shot production completion
- `shared/sceneVersions.ts` for current/candidate generation versions
- `shared/timeline.ts` for frame-aligned timeline truth
- `shared/sceneMusic.ts` for current music span semantics
- `client/src/features/storyboard-center/*` for storyboard UI
- `client/src/features/animation-studio/StoryboardTimeline.tsx` for visual ordering/timing
- `client/src/features/delivery/DeliveryRoom.tsx` for final-state projection

---

# 2. P0 before any implementation: sync branch to CURRENT default

#706 is already merged into default. #707 was created from the pre-#706 base.

Mandatory sequence:

```text
fetch current default
merge/rebase safely into feat/aios-gemini-omni-creative-agent
resolve conflicts
NO force-push
re-run current repo audit
run baseline validation
only then modify production code
```

Record the synced default SHA and baseline test evidence in PR #707.

If sync reveals that a planned component already exists, **delete the duplicate plan and extend the existing implementation**.

---

# 3. Implementation Slice A — Provider Adapter seam, with zero behavior change first

## 3.1 Goal

Before adding Gemini, remove the provider-specific dispatch from `generationCore` behind one minimal provider seam while keeping Fal/NIM behavior byte-for-byte equivalent from the caller’s perspective.

Suggested files (adapt naming to repo convention):

```text
server/services/generationProviders/types.ts
server/services/generationProviders/registry.ts
server/services/generationProviders/falAdapter.ts
server/services/generationProviders/nimAdapter.ts
server/services/generationProviders/geminiAdapter.ts
server/services/generationProviders/providerRuntimeMeta.ts
```

Do NOT move worldview/card/continuity/billing code into adapters.

## 3.2 Provider contract

The adapter must be small and infrastructure-oriented:

```ts
type ProviderMediaResult =
  | {
      mode: "inline";
      mime: string;
      bytes: Buffer;
      interactionId?: string;
      resultText?: string;
      usage?: Record<string, number>;
    }
  | {
      mode: "remote";
      url: string;
      mime?: string;
      interactionId?: string;
      usage?: Record<string, number>;
    }
  | {
      mode: "poll";
      requestId: string;
      interactionId?: string;
      state: "queued" | "running";
      runtime?: Record<string, unknown>;
    };

interface GenerationProviderAdapter {
  canHandle(model: ModelEntry): boolean;
  submit(input: {
    model: ModelEntry;
    providerInput: Record<string, unknown>;
    idempotencyKey: string;
    runtime?: ProviderRuntimeMeta;
    signal?: AbortSignal;
  }): Promise<ProviderMediaResult>;
  poll?(input: {
    model: ModelEntry;
    requestId: string;
    runtime?: ProviderRuntimeMeta;
    signal?: AbortSignal;
  }): Promise<ProviderMediaResult | { mode: "failed"; error: string }>;
  cancel?(...): Promise<void>;
}
```

Do not expose provider raw response objects above this boundary.

## 3.3 Runtime metadata in `generations.params`

Use a namespaced internal payload such as:

```ts
interface ProviderRuntimeMeta {
  v: 1;
  provider: "fal" | "nvidia-nim" | "gemini";
  interactionId?: string;
  fileName?: string;
  fileUri?: string;
  previousInteractionId?: string;
  delivery?: "inline" | "uri";
  task?: string;
  parentGenerationId?: string;
  referenceAssetIds?: string[];
}
```

Store under a private key, e.g. `params.__providerRuntime`.

Mandatory helper:

```text
splitProviderRuntimeMeta(params)
storeProviderRuntimeMeta(params, meta)
```

The helper MUST ensure this metadata is removed before constructing any third-party provider payload.

Never store:

- API key
- full base64 outputs
- raw request/response headers
- private chain-of-thought

## 3.4 Refactor order

1. Write adapter contract tests.
2. Wrap Fal with `falAdapter`.
3. Wrap NIM with `nimAdapter`.
4. Run all generation tests and prove no behavior drift.
5. Only then add Gemini.

This avoids debugging “provider refactor + new provider + Agent behavior” in one change.

---

# 4. Implementation Slice B — Gemini adapter, production-safe

Official baseline verified 2026-08-13:

- Gemini Image: `gemini-3.1-flash-image`
- Gemini Omni video: `gemini-omni-flash-preview`
- Interactions API is the recommended API surface.
- Image supports multi-turn editing via `previous_interaction_id`.
- Omni supports text/image/reference-to-video and stateful edits via `previous_interaction_id`.
- Omni supports URI delivery for large videos; file status can be polled through Files API.

Official docs must be rechecked on implementation day.

## 4.1 Do not permanently handle generated videos as base64

For Omni video, default production strategy:

```json
{
  "response_format": {
    "type": "video",
    "delivery": "uri"
  }
}
```

Why:

- avoids huge JSON/base64 payloads in Node memory
- maps naturally onto current durable generation polling
- lets storage ingest the final media after Google file becomes ACTIVE

Persist:

- interaction id
- file name/id
- task
- parent generation/source asset

Then let `advanceGeneration` / provider poll converge the job.

## 4.2 Stateful edit behavior

For image/video edits:

```text
source generation has provider runtime interactionId
+ same Gemini model family is applicable
→ previous_interaction_id
→ instruction-only edit
```

If no valid interaction id:

```text
source asset exists
→ reference-based edit/regeneration
→ UI labels it “重新生成/參考修正”
```

Never falsely label regeneration as stateful edit.

## 4.3 `store` policy

Stateful Gemini editing needs the interaction history to remain available. If the API exposes storage control, requests intended for follow-up editing must preserve/store the interaction.

A “one-shot throwaway” mode may disable storage only if the product explicitly chooses it and the UI does not offer conversational continuation.

## 4.4 Inline image handling

Gemini Image commonly returns inline image bytes.

Required flow:

```text
Interactions response
→ decode once to Buffer
→ storage.saveBuffer(buffer, mime)
→ create asset record with storagePath
→ generation finalizer
→ scene pointer/read-back
```

Never:

```text
base64 → generations.params
base64 → assistant response
base64 → client localStorage
```

## 4.5 Gemini request safety

- backend only `GEMINI_API_KEY`
- timeout with abort controller
- bounded response size
- no raw response logging
- redact provider errors before user display
- enforce current upload/result storage limits
- mark provider preview maturity truthfully
- feature flag default OFF until live certification passes

---

# 5. Implementation Slice C — Extract one canonical generation finalizer

Current Fal completion logic must not be copied into Gemini code.

Extract/reuse a single helper conceptually like:

```ts
finalizeGenerationResult({
  generation,
  result: {
    storagePath?,
    remoteUrl?,
    mime,
    sizeBytes?,
    resultText?,
    providerRuntime?,
    sourceAssetId?,
  },
})
```

It owns the transition from provider success to **verified product success**.

## 5.1 Finalizer order

```text
1. lock/re-read generation
2. if already done → return existing verified result
3. make media durable in storage
4. create asset
5. write asset revision if derivative
6. update generation result metadata
7. update scene role pointer if scene-bound
8. read back scene + asset + generation
9. settle actual points
10. publish realtime / event
11. only now mark verified complete
```

If any mandatory step fails, do not return completed.

## 5.2 Failure semantics

### Provider success + storage failure

```text
status ≠ done
UI = failed_retryable / storage pending
retry must re-use provider result when recoverable
must not call provider again automatically
must not charge again
```

### Storage success + scene attach failure

```text
asset exists
provider must NOT be re-called
retry only attachment/read-back step
```

This is a critical #707 acceptance case.

---

# 6. Implementation Slice D — Use existing lineage properly

## 6.1 Generated derivative lineage

Whenever a new asset is derived from one specific source asset:

```text
new asset
→ asset_revisions.sourceAssetId = source asset
```

Examples:

- Image V2 edited from Image V1
- Video generated from storyboard Image V3
- externally edited Video V2 returned from Video V1

For multiple references, keep the primary parent in `asset_revisions` only when one true parent exists; store additional reference IDs in generation runtime/context metadata.

Do not lie by picking an arbitrary “parent” among equal references.

## 6.2 Generation lineage metadata

Persist at minimum:

```text
parentGenerationId?
sourceAssetId?
referenceAssetIds[]
provider interactionId?
contextFingerprint
selected scope
```

Prefer namespaced generation params unless a query-critical field proves it needs a real indexed column.

## 6.3 Current version truth remains scene pointer

Do not replace:

- `scenes.assetId`
- `scenes.narrationAssetId`
- `scenes.ambienceAssetId`

with another “selected version” store.

Version history is projection; current pointers are truth.

---

# 7. Implementation Slice E — Context/Reference Compiler + fingerprint

The current continuity snapshot is strong but #707 needs a reproducible **creative context package** for partial recompute and provenance.

## 7.1 Compiler input

For a Shot generation, resolve only bounded relevant context:

```text
Project worldview/style
Story scene environment
Shot camera/performance/action/dialogue/voiceover
Characters
Character looks
Scene presets
Props/carried props
current source asset
adjacent selected references (bounded)
user instruction
model capability limits
```

Do not dump the entire project into the model.

## 7.2 Canonical fingerprint

Create a pure normalizer + SHA-256:

```ts
interface CreativeContextFingerprintInput {
  projectStyle: unknown;
  storyScene: unknown;
  shot: unknown;
  characters: unknown[];
  looks: unknown[];
  scenePresets: unknown[];
  props: unknown[];
  sourceAssetIds: string[];
  instruction: string;
  outputRole: string;
}
```

Normalize:

- stable object key order
- sorted ID sets
- omit timestamps/non-semantic fields
- omit signed URLs
- include semantic revision/value only

Store:

```text
params.__creativeContextFingerprint
```

## 7.3 Why fingerprint matters

It enables:

```text
current shot/context fingerprint
!= generation fingerprint
→ output is stale
```

without needing dozens of duplicated “isDirty” booleans.

---

# 8. Implementation Slice F — Dependency-aware stale projection and partial recompute

Do not automatically regenerate everything when anything changes.

Create a pure dependency classifier, e.g.:

```ts
type CreativeChangeKind =
  | "story_text"
  | "shot_visual_direction"
  | "character_identity"
  | "character_look"
  | "scene_environment"
  | "prop_visual"
  | "voiceover_text"
  | "ambience_text"
  | "shot_duration"
  | "selected_image_version"
  | "selected_video_version";
```

Map changes to affected outputs.

Minimum rules:

```text
voiceover_text
→ narration stale
→ image/video NOT stale

ambience_text
→ ambience stale
→ image/video NOT stale

character_identity / character_look
→ affected shot image stale
→ video derived from stale image stale

scene_environment / prop_visual / visual direction
→ affected image stale
→ dependent video stale

selected_image_version changes
→ video whose source was old image becomes stale

shot_duration
→ rough cut/timeline stale
→ generated image not stale
→ generated video only stale if product requires duration-coupled regeneration
```

UI states:

```text
current
stale
missing
generating
failed
blocked
```

Do not silently auto-repair a stale item unless autonomy + budget policy allows it.

---

# 9. Implementation Slice G — Auto Model Router = extend `aiModelPolicy`, not replace it

The current policy already supports quality/budget/speed, maxPoints, model health and alternatives.

Extend the request with capability constraints rather than creating a new router.

Concept:

```ts
interface CreativeModelRequirements {
  output: "image" | "video" | "audio" | "text";
  sourceKind?: "image" | "video" | "audio";
  task?: "create" | "edit" | "reference";
  referenceCount?: number;
  needCharacterConsistency?: boolean;
  needMultiTurnEdit?: boolean;
  aspectRatio?: string;
  outputSize?: string;
  nativeAudioPreferred?: boolean;
}
```

Extend model metadata only as required:

```text
provider family
supported tasks
max reference images
multi-turn edit support
URI output support
supported aspect ratios
supported output sizes
native audio support
preview/stable maturity
```

## 9.1 Planner should select POLICY, not hardcode model IDs

Bad:

```text
planner emits modelId=gemini-omni-flash-preview everywhere
```

Good:

```text
planner emits:
preference=quality
maxPoints=30
freeOnly=false
requiredCapabilities=[image_to_video, references]
```

At execution time:

```text
resolve policy against current healthy catalog
→ persist selected modelId into step
→ from then on replay uses the persisted modelId
```

This gives current-health routing without non-deterministic retries.

## 9.2 Cost enforcement

`freeOnly`, `maxPoints`, approval threshold, explicit provider choice are HARD constraints, not scores.

If no model fits:

```text
blocked_by_budget / provider_unavailable
```

Do not silently upgrade to a more expensive model.

---

# 10. Implementation Slice H — Agent creative step contract

Avoid exploding the Agent runner with 20 new step kinds.

## 10.1 Reuse current step kinds where semantics already fit

Use:

- `split_script`
- `create_scene`
- `update_scene`
- `reorder_scenes`
- `generate`
- `voiceover`
- `request_approval`
- `wait_for_human`
- `checkpoint` only if CURRENT runner already supports it after sync

## 10.2 Extend `generate` payload instead of creating image/video-specific step kinds

Add only fields needed for deterministic creative execution:

```ts
sceneRole?: "visual" | "narration" | "ambience";
generationPolicy?: {
  preference: "balanced" | "quality" | "budget" | "speed";
  maxPoints?: number;
  freeOnly?: boolean;
  requiredCapabilities?: string[];
};
generationIntent?: "create" | "edit";
sourceGenerationId?: string;
parentGenerationId?: string;
expectedContextFingerprint?: string;
```

At first execution:

```text
resolve target scene id
resolve current source/current revision
resolve model policy
persist modelId + targetSceneId + baseline/fingerprint
persist generationId placeholder
submit canonical generation command
```

Replay MUST use the persisted target/model/generation id.

## 10.3 Edit flow

Example:

> 第 8 鏡角色不要笑，鏡頭靠近，其他不要變。

Plan should resolve to:

```text
update_scene? (only if camera data itself is meant to change)
+ generate(edit) from current visual
+ sourceGenerationId=current generation when available
+ expected source asset/revision
```

If user only wants a rendered variation without changing the semantic Shot direction fields, do not mutate camera/performance unnecessarily.

---

# 11. Implementation Slice I — Human/Agent concurrency

Current repo already has revision guard machinery. Creative generation must use the same principle.

## 11.1 Capture baseline before expensive work

Before a generation/edit step begins persist:

```text
targetSceneId
scene rev/baseRevision
sourceAssetId
current context fingerprint
current selected version
```

Before final attach:

```text
re-read target
```

If the human changed relevant state while provider was running:

```text
DO NOT overwrite
asset may still be retained as candidate
step → waiting/conflict
show:
“你在生成期間更新了這一鏡；新結果已保留，但沒有自動覆蓋目前版本。”
```

This is superior to throwing away paid output and superior to overwriting human work.

## 11.2 Multi-select operations

Freeze the exact selected target IDs at plan/run creation.

Never re-resolve “目前選中的鏡” halfway through a durable run.

---

# 12. Implementation Slice J — Creative Project Status projection

The UI should not assemble creative truth through many independent client queries.

Create or extend one bounded backend projection, conceptually:

```ts
interface CreativeProjectStatus {
  projectId: string;
  stages: Array<{
    id: "story" | "references" | "shots" | "image" | "video" | "audio" | "review" | "rough_cut" | "delivery";
    state: "not_started" | "partial" | "ready" | "blocked" | "failed" | "running";
    completed: number;
    total: number;
    stale: number;
    missing: number;
    blocked: number;
  }>;
  shots: Array<{
    id: string;
    ordinal: number;
    image: string;
    video: string;
    voice: string;
    audio: string;
    review: string;
    currentVisualAssetId?: string;
    staleReasons: string[];
  }>;
  activeRun?: {
    id: string;
    status: string;
    currentTitle?: string;
  };
  suggestedActions: CreativeCapabilitySuggestion[];
}
```

Derive from:

- scenes
- current scene pointers
- generation active/done state
- `shotCompletion`
- context fingerprints
- active agent run
- provider readiness / policy

## 12.1 Query performance

- one bounded project query path
- no per-shot N+1 loops over generations
- aggregate active generation state in SQL or one project-wide query
- cap versions shown in list views; full history only on demand
- lazy media URLs

---

# 13. Implementation Slice K — Dynamic capability applicability

Current `assistantCapabilityRegistry` is page-term based. That is useful for bounded exposure, but the visual Creative OS needs a stronger **applicability layer**.

Do not replace the MCP catalog. Add an applicability projection over real tools.

Concept:

```ts
interface CreativeCapabilitySuggestion {
  capabilityId: string;
  label: string;
  scope: { projectId: string; sceneIds?: string[] };
  state: "ready" | "blocked" | "unavailable";
  reason: string;
  estimatedPoints?: number;
  preferredPolicy?: string;
}
```

Examples:

```text
Storyboard page + 5 shots have no image + user can edit
→ “生成剩餘 5 張分鏡圖” ready

3 selected shots + all have visual assets
→ “把選中 3 鏡做成影片” ready

selected shot has no visual/reference and chosen video path needs source
→ blocked: “先完成分鏡圖”

freeOnly + no free compatible video provider
→ blocked_by_budget, do not display as executable
```

UI must never advertise a button the backend knows cannot execute.

---

# 14. Implementation Slice L — Selection-aware Aios without a second chat system

Reuse current `assistantContext` and current Aios surfaces.

## 14.1 Wire scope into request

When user submits from storyboard:

```text
projectId
pageType=storyboard
entityType=shot
entityId=single focused shot if one
selectedEntityIds=frozen selected shots
activeTab
```

Backend still revalidates ownership/ACL.

## 14.2 Prompt bar display

Examples:

```text
作用範圍：第 8 鏡
作用範圍：已選 3 鏡
作用範圍：第一幕
作用範圍：整個專案
```

If scope is stale after navigation, clear it instead of guessing.

## 14.3 Assistant text becomes secondary

Aios response should favor:

```text
what changed
what is still running
what failed/blocked
open result
undo/retry/continue
```

over long prose.

---

# 15. Implementation Slice M — Continuity/QC: deterministic first

Do not begin with a VLM “quality score”. First implement checks whose truth is already in product data.

## 15.1 Deterministic checks

Per shot:

- required character has reference?
- selected look exists?
- scene preset exists?
- carried prop reference exists?
- current visual generated with current context fingerprint?
- video source matches current selected image version?
- scene pointer points to live asset?
- generation done but asset missing?
- aspect ratio consistent with project format?
- duration/timeline valid?

## 15.2 Optional multimodal review

Only after deterministic checks, optional model review may report:

```text
identity drift
costume drift
background drift
camera mismatch
obvious artifact
```

But:

- label confidence
- never silently delete/replace based only on model judgement
- bounded auto-repair attempts
- respect maxPoints/autonomy policy
- final “approved” remains explicit human/product truth unless product requirements say otherwise

## 15.3 Bounded auto-repair

Default:

```text
max automatic repair attempts per shot = 1
```

A second attempt requires either explicit user permission or a run-level autonomy rule + remaining budget.

No infinite “AI judges AI and retries forever” loops.

---

# 16. Implementation Slice N — Audio as a first-class production concern, without schema explosion

## 16.1 P0 use current truths

The current product already has:

- narration pointer
- ambience pointer
- dialogue/voiceover text
- scene music span semantics
- audio generation models
- timeline audio lanes

P0 #707 must fully automate the fields that have clear current persistence semantics:

```text
voiceover/narration
ambience
existing music span/readiness
```

## 16.2 Do not fake SFX/music bindings

If CURRENT HEAD has no canonical per-shot SFX or selected music asset pointer, do not stuff hidden asset IDs into random JSON and call it done.

Either:

1. use the existing semantic slot if sync reveals one, or
2. add the smallest reviewed schema extension in a separate migration, with explicit owner/query/timeline integration.

No new generic `audio_slots` table unless current model truly cannot represent the requirement.

## 16.3 “Generate missing audio” behavior

Only generate missing/stale slots.

```text
narration already current → skip
ambience already current → skip
voice text changed → narration only
visual changed → audio unchanged unless semantic audio dependency changed
```

---

# 17. Implementation Slice O — Rough Cut = projection over existing timeline, not a new NLE

Build a `RoughCutProjection` from current selected assets and frame truth.

Concept:

```ts
interface RoughCutShot {
  shotId: string;
  startFrames: number;
  durationFrames: number;
  visualAssetId?: string;
  narrationAssetId?: string;
  ambienceAssetId?: string;
  musicSpan?: unknown;
  readiness: "ready" | "partial" | "blocked";
}
```

Use:

- `shared/timeline.ts`
- current scene pointers
- `sceneMusic` spans
- existing preview/render path
- existing StoryboardTimeline
- DeliveryRoom

A rough cut is “ready” only when the product can actually preview/export the selected media sequence.

Do not create a second timeline database.

---

# 18. Implementation Slice P — Run-level Change Set + safe Undo

Users need to see what an Agent changed.

Do not store chain-of-thought. Project a change set from actual execution receipts/events.

Example:

```text
Run #...
+ created 5 shots
+ generated 5 images
+ switched Shot 3 visual V1 → V2
+ generated narration for Shots 1,2,4
! Shot 5 video failed
```

## 18.1 Reversible operations

Undo may safely perform domain operations such as:

- restore previous current scene asset pointer
- restore previous narration/ambience pointer
- soft-delete Agent-created scene if unchanged since run
- revert Agent-applied shot fields if current value still equals Agent’s write

Undo MUST NOT:

- delete historical generated assets just because current pointer changes
- refund already-consumed provider points
- overwrite newer human edits
- “undo” external provider computation

Store enough before/after references in step audit/outputRefs to implement safe CAS-style undo.

---

# 19. Implementation Slice Q — Live execution visualization

Reuse Agent events. Add creative aggregation, not fake steps.

## 19.1 Event granularity

For a batch of 12 shots, do not emit 500 UI rows.

Backend may emit:

```text
phase: storyboard images
progress: 7/12
failed: 1
waiting: 0
```

with per-shot detail available on expand.

## 19.2 Required UI states

- queued
- running
- awaiting approval
- waiting user input
- partial success
- retryable failure
- terminal failure
- stopped
- verified complete

## 19.3 Truth rules

A creative phase can be green only when its underlying persisted targets are verified.

`provider HTTP 200` is not completion.

---

# 20. Implementation Slice R — Visual workspace exact integration points

Prefer modifying these existing surfaces:

```text
client/src/pages/ProjectPage.tsx
client/src/features/storyboard-center/StoryboardStage.tsx
client/src/features/storyboard-center/ShotCard.tsx
client/src/features/storyboard-center/ResourceDock.tsx
client/src/components/SceneStudio.tsx
client/src/features/animation-studio/StoryboardTimeline.tsx
client/src/features/delivery/DeliveryRoom.tsx
client/src/components/AICreativeCopilot.tsx
client/src/components/AgentRunCard.tsx
client/src/components/AgentWorkPanel.tsx
```

Suggested new small components only when responsibility is genuinely new:

```text
CreativePipeline.tsx
CreativeStatusPanel.tsx
CreativeScopeBar.tsx
CreativeBibleProjection.tsx
CreativeRunProgress.tsx
CreativeStaleBadge.tsx
ModelPolicyPicker.tsx
```

Do not create a new full-page Creative app alongside ProjectPage unless CURRENT routing architecture proves it necessary.

## 20.1 Creative Bible is a projection

Character Bible UI should read existing Character + Look + reference asset.

Scene Bible reads scene preset/environment/reference.

Style Bible reads worldview/style.

Props reads props/card reference.

Do not duplicate those values into a new “Bible” table.

---

# 21. Implementation Slice S — Mobile and accessibility engineering

At ~390px:

```text
Pipeline (horizontal scroll or compact stages)
→ Storyboard
→ sticky/fixed-safe Prompt Bar
→ sheets/tabs for Bible / Aios / Versions
```

Requirements:

- no permanent desktop three-column layout
- touch targets >= 44px
- multiselect usable by touch
- selected scope always visible before destructive/paid bulk action
- agent progress does not cover the media stage
- status not color-only
- generated media has accessible labels
- live progress uses `aria-live` with throttled meaningful updates, not every token/event

---

# 22. Implementation Slice T — Failure injection matrix

Before Ready, explicitly inject/cover:

| Failure | Expected behavior |
|---|---|
| Gemini 401/403 | capability unavailable; no charge; actionable config message |
| Gemini 429 | bounded backoff; no duplicate generation row/charge |
| Gemini timeout before response | retry only if idempotency/provider semantics safe |
| Omni URI file processing FAILED | generation failed/refund per current rules |
| provider success + `saveBuffer` fails | not complete; no provider re-call on storage retry if output retained |
| provider success + remote download fails | landed/pending truth; no false done if durable asset required |
| asset created + scene attach conflict | keep candidate asset; do not overwrite human edit |
| human edits Shot during generation | conflict/wait; preserve generated candidate |
| user changes selected shots after run start | run keeps frozen original target IDs |
| reload during batch | same run resumes, no duplicate rows |
| stop during running provider call | no new downstream steps; in-flight result settles safely |
| budget runs out mid-batch | partial success + blocked remainder, no silent provider switch |
| free-only + only paid compatible provider | blocked, no request sent |
| previous_interaction_id invalid | explicit fallback to source-based regeneration or fail; no false edit label |
| source image deleted mid-run | no wrong source substitution; wait/fail truthfully |

---

# 23. Implementation Slice U — Test architecture

## 23.1 Pure unit tests

Add tests for:

- provider runtime metadata split/store
- provider adapter selection
- Gemini response parsing
- model capability routing
- creative context fingerprint stability
- change→stale dependency matrix
- capability applicability
- creative pipeline aggregation
- rough-cut readiness
- change-set projection

## 23.2 Server integration tests

With mocked provider **at provider boundary**, not mocked generation command:

```text
Agent generate
→ generationCommand
→ quota
→ generation row
→ provider adapter
→ storage
→ asset
→ scene pointer
→ read-back
```

Test both immediate inline image and polled URI video.

## 23.3 Live certification tests

Only when real credentials are available:

- one tiny Gemini Image generation
- one image edit retaining interaction id
- one minimal Omni video via URI delivery
- one stateful Omni edit if region/account permits

Record model id, duration, output mime/size and cleanup result.

Do not log prompt if it may contain private project content.

If credentials unavailable: `BLOCKED_BY_EXTERNAL_DEPENDENCY`, not PASS.

## 23.4 Existing required gates

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

Migration only if truly required:

```text
npm run db:migrate:dry-run
npm run db:check
npm run verify:database-runtime
npm run verify:agent-db-integrity
```

---

# 24. Recommended production implementation order

Do not implement this as one enormous unreviewable commit.

## Commit/Slice 1 — Sync + baseline

- merge current default
- resolve #706 overlap
- baseline tests
- no feature behavior change

## Commit/Slice 2 — Provider seam

- adapter types/registry
- Fal/NIM adapters
- generationCore uses registry
- all existing generation tests green

## Commit/Slice 3 — Gemini provider

- config/feature flag
- Gemini Image inline path
- Omni URI path
- runtime metadata
- provider unit tests

## Commit/Slice 4 — Unified finalizer + lineage

- saveBuffer/remote result normalization
- asset revision writing
- stateful edit metadata
- storage/attach partial-failure tests

## Commit/Slice 5 — Creative status + stale graph

- context fingerprint
- dependency matrix
- CreativeProjectStatus projection
- capability applicability

## Commit/Slice 6 — Agent creative execution

- generationPolicy in plan/step
- runtime model resolution then persist chosen model
- selected target freeze
- edit/sourceGeneration handling
- concurrency conflict handling

## Commit/Slice 7 — Visual Creative Workspace

- pipeline
- scope bar
- dynamic capability cards
- live run progress
- stale/version badges
- Creative Bible projection

## Commit/Slice 8 — Rough cut + delivery integration

- existing timeline projection
- audio readiness
- DeliveryRoom integration
- rough-cut preview/readiness

## Commit/Slice 9 — Failure certification + mobile

- failure injection
- reconnect/stop/out-of-budget
- 390px pass
- accessibility pass
- fresh-eye x2

Each slice should leave the branch buildable.

---

# 25. P0 / P1 / P2 scope discipline

## P0 — PR #707 cannot be Ready without

- synced current default
- provider seam
- Gemini Image real integration path
- Gemini Omni real integration path or truthful external-blocked certification
- story→shots→image end-to-end
- shot→video end-to-end
- selection-aware Aios action
- context/reference freeze
- version/lineage preservation
- stale/downstream correctness
- creative status/pipeline from persisted truth
- dynamic capability applicability
- durable Agent run/reconnect
- budget/approval enforcement
- human edit conflict protection
- rough-cut readiness projection
- desktop + mobile
- no false completion

## P1 — desirable immediately after P0

- stronger multimodal QC
- bounded auto-repair
- more nuanced model capability scoring
- full run-level safe undo UI
- richer scene/character Bible editing shortcuts
- cross-shot batch editing optimization

## P2 — explicitly not a blocker for this PR

- generic node graph editor
- full Premiere/Resolve clone
- autonomous unlimited VLM quality loops
- Deep Research product mode
- training/fine-tuning pipeline
- generalized multi-agent employee simulation

---

# 26. Anti-patterns that must fail review

Reject implementation if it does any of these:

- `assistant.ts` directly calls Gemini and returns media
- client contains Gemini key
- another agent/task runner is added
- another selection store is added
- another completion/progress truth is stored
- provider result is called complete before storage/binding/read-back
- base64 media is persisted in DB JSON
- Gemini model IDs are scattered through UI components
- planner hardcodes provider/model without policy need
- bulk run re-resolves current selection mid-run
- retry generates another paid output when only attachment failed
- stateful edit is claimed without a valid interaction lineage
- human changes are overwritten after a long provider call
- regenerated output silently destroys old version
- stale downstream video remains green after source image switches
- audio-only edit causes unnecessary image/video regeneration
- fake progress timers are displayed
- mock provider is presented as live production validation

---

# 27. Ready Gate 3.0 — implementation-level certification

PR #707 stays Draft until the following exact scenario works against persisted product state:

> 「Aios，把這個故事的第一幕做成可以看的粗剪。人物和服裝保持一致，最多 30 點；先用目前選中的角色與場景設定，缺的分鏡、畫面、影片、旁白與環境音幫我補齊。不要動我已經通過審核的鏡頭。如果生成期間我改了某一鏡，不要蓋掉我的版本。完成後告訴我做了哪些變更、哪些仍然失敗或需要我決定。」

The system must demonstrably:

```text
resolve exact project + frozen scope
→ inspect current shots/current approved state
→ plan only missing/stale work
→ compile current references
→ choose models under policy
→ persist selected model/targets
→ execute through existing command/billing/ACL
→ generate and persist media
→ preserve version lineage
→ detect concurrent human changes
→ avoid overwriting changed targets
→ update only valid current pointers
→ derive downstream stale state correctly
→ build rough-cut readiness from existing timeline truth
→ show truthful live progress
→ return a verified change set
```

Any shortcut that only produces prompts, JSON plans, temporary provider URLs, or optimistic UI does **not** satisfy #707.