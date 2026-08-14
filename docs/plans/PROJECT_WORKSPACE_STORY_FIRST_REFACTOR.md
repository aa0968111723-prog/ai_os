# AIOS Project Workspace — Story-first Deep Refactor Brief

> **2026-08-14 方向更新：** 最新專案頁資訊架構請以 [PROJECT_WORKSPACE_STORY_INLINE_GENERATION_PLAN.md](./PROJECT_WORKSPACE_STORY_INLINE_GENERATION_PLAN.md) 為準。新方向取消「故事／分鏡／製作／成片」四個主要頁籤，改為故事單一主畫面、所有能力按需收合，以及先生成成果再局部細修。本文仍保留作為資料模型、安全、相容性與工程約束的技術基線；與新文件衝突的導航、工作區拆分與使用者流程段落已被取代。

> Status: canonical implementation brief for the Project Page refactor.
> Target repo: `aa0968111723-prog/ai_os`
> Main route contract: keep `/p/:id` compatible.

## Mission

Deeply refactor the current Project Page into a **Story-first AI Director Workspace**.

The product principle is:

> Human creates the story. AI structures the production. Storyboard is the center of production.

The current project page already contains substantial real functionality (worldview, characters, costumes, scene presets, props, knowledge, assets, databases, recycle bin, creation workbench, realtime collaboration, generation gates). Do **not** replace it with a pretty empty mockup. Preserve real capabilities and migrate them into a clearer information architecture.

Implementation strategy:

**PRESERVE → EXTRACT → ADAPT → MIGRATE → REPLACE → VERIFY**

## Required new primary flow

Replace the current concept of a large setup-oriented page with four primary stages:

1. **故事 / Story**
2. **分鏡 / Storyboard**
3. **製作 / Production**
4. **成片 / Final**

Project world data remains important but moves behind a secondary **Project Context / Project Settings** surface:

- style / worldview
- characters
- character looks / costumes
- locations
- environment states
- props
- knowledge
- assets
- databases / integrations
- versions
- recycle bin

These systems must support creation, not block it.

## Core UX acceptance test

A first-time user with this story:

> 清晨，下著細雨。安倢穿著米白色外套，撐著紅傘走下克難坡。她踩過水窪，停下來望向天空。

must be able to:

1. enter a project;
2. paste the story;
3. click **AI 解析故事**;
4. have AI identify the character, location, prop, weather/time and relevant story structure;
5. only answer genuinely uncertain items;
6. click **產生分鏡**;
7. see structured Scene / Shot cards;
8. choose a Shot and continue into existing image/video generation capability.

The user must **not** be required to manually visit character, location, prop, knowledge, asset, database or worldview management before creating the first storyboard.

## Scope boundaries

Primary scope:

- `/p/:id`
- Project Page and direct child features
- project-specific UI/state/hooks
- necessary tRPC procedures
- necessary Drizzle schema/migrations
- Story / Scene / Shot domain
- AI parsing and entity-linking layer
- project generation context
- compatibility adapters
- tests for the critical vertical slice

Do not casually rewrite unrelated global areas such as Dashboard, Planner, Chat, Community, Admin or authentication.

## Repository-first audit is mandatory

Before changing architecture, inspect the actual repository and map:

- `client/src/pages/ProjectPage.tsx`
- project routing (`/p/:id`)
- `CreationWorkbench`
- character / scene / prop / costume components
- knowledge / asset / database components
- worldview helpers
- project navigation helpers and events
- realtime/collaboration zones
- shared domain types
- Drizzle schema and migrations
- tRPC routers and authorization
- AI/provider/model abstractions
- generation gates, quota, model contracts
- tests and build checks

Do not stop after producing a plan. Continue directly into implementation unless a truly destructive decision requires user input.

## Target client architecture

The exact file names may adapt to repo conventions, but responsibilities should become approximately:

```text
ProjectPage (route shell)
└── ProjectWorkspace
    ├── ProjectHeader
    ├── ProjectStageNav
    ├── StoryWorkspace
    ├── StoryboardWorkspace
    ├── ProductionWorkspace
    ├── FinalWorkspace
    ├── ProjectContextDrawer / Settings
    └── ContextAwareAIAssistant
```

`ProjectPage.tsx` should end up primarily responsible for route-level loading, permission, project retrieval, workspace shell and top-level error/loading boundaries—not every project domain feature in one file.

## Story workspace

Story is the default creative entry point.

Minimum behavior:

- project title
- long-form story editor
- autosave with clear Saving / Saved / Error state
- explicit **AI 解析故事** action
- parse loading / error / success states
- detected entity summary
- uncertainty count and resolution UI
- project style summary
- continue-to-storyboard CTA
- mobile-friendly editing

Avoid building a giant CMS form or a brand-new rich-text engine unless the existing repo already has one suitable for reuse.

## AI story parsing

The parser must be a real structured pipeline, not keyword-only regex and not an LLM writing directly to DB.

Required flow:

```text
STORY
→ EXTRACT
→ VALIDATE
→ NORMALIZE
→ RESOLVE
→ CONFIDENCE
→ DIFF
→ PERSIST
```

Use structured output validated with Zod.

First useful extraction set:

- Character
- Character appearance
- Character look / costume
- Location
- Environment
- Prop
- Action
- Emotion / performance
- Dialogue / narration
- Style hints
- Sound hints
- time / weather when relevant

LLM/provider output is untrusted input. Validate and normalize before persistence.

If the repo already has an AI/model abstraction, reuse it. Do not create a parallel provider system.

## Entity resolution

The system must resolve references such as:

- `她` → `安倢`
- `那把傘` → `紅傘`

Avoid duplicate characters/props caused by pronouns or referring expressions.

Use centralized confidence logic. Suggested product behavior:

- high confidence: auto-link
- medium confidence: suggest and mark for review
- low confidence: require user confirmation

Do not dump every extracted item back to the user for manual confirmation. Only uncertainty should interrupt the flow.

## Character domain

Separate stable identity from scene-specific look and shot-specific performance.

Conceptually:

```text
Character
├── Identity (stable appearance)
├── CharacterLook[] (outfit/accessories)
├── owned/carried Props
└── Shot Performance (emotion/action/gaze/pose)
```

Shots should reference `characterId` + optional `lookId`, rather than duplicating a full character description into every shot.

## Location / environment domain

Do not treat `雨天克難坡`, `晴天克難坡`, `夜晚克難坡` as unrelated locations.

Use:

```text
Location: 克難坡
EnvironmentState: 雨天清晨 / 晴天下午 / 夜晚
```

Scenes/Shots reference location + environment state.

## Scene and Shot model

Story must become structured Scenes and Shots.

Scene should be able to express at least:

- title / summary / order
- source story range or relation
- location
- environment state
- characters / default looks
- props
- emotion arc
- time / weather
- style overrides
- sound/music hints
- estimated duration

Shot should be able to express at least:

- scene relation
- order / duration
- visual description
- source story relation
- character/look references
- location/environment reference
- prop references
- action
- emotion/performance
- camera suggestion
- dialogue/narration
- sound
- reference assets
- generation versions / status

Do not overbuild a cinema-grade camera system in the first pass.

## Inheritance instead of duplication

Use project → scene → shot inheritance.

Example:

```text
Project: 療癒繪本電影 / 16:9 / low saturation
Scene: 克難坡 / 雨天 / 清晨
Shot: 50mm / low angle / foot close-up
```

Build a reusable resolver such as `resolveShotContext(...)` and a normalized generation context builder such as `buildShotGenerationContext(...)`.

## Storyboard workspace

Storyboard is the central production surface.

A Shot Card should show only the information needed at a glance:

- preview
- description
- duration
- character/look
- location/environment
- important props
- basic performance
- basic camera
- basic sound
- actions: edit / AI refine / generate image / generate video / more

Use progressive disclosure.

Simple mode: image/people/location/action/duration.

Pro mode may reveal camera/lens/movement/composition/lighting and deeper controls.

## Story → Storyboard generation

AI should create structured `ShotDraft[]` data, validate it, resolve entity references, diff it against existing shots, then persist.

If a storyboard already exists, do not silently overwrite it. Show a change preview for meaningful/bulk changes and make structural AI changes undoable/revision-tracked where practical.

## Bidirectional impact

If a story/entity change affects existing shots or generations, surface the impact.

Example: changing `紅傘` → `黃色雨傘` can affect several shots and generated media.

Do not silently regenerate expensive assets. Mark affected generations as outdated / needs regeneration and allow scoped updates where feasible.

## Incremental parsing

Do not re-parse the entire project on every keystroke.

Use an incremental strategy suitable for the current architecture: content hashes, block revisions, source ranges or another explicit change boundary.

AI parsing should normally be user-triggered or otherwise cost-aware; it must not call an LLM on every character typed.

## Project Context migration

Existing functionality must remain accessible but leave the primary creation path.

Suggested mapping:

- worldview → project style / constraints
- character cards → Character
- costume data → CharacterLook
- scene presets → Location / EnvironmentState or compatible project-world data
- props → Prop
- knowledge → KnowledgeSource
- assets → Asset source/reference system
- project databases/integrations → Project Context
- recycle bin → project menu/settings

Do not delete legacy data simply because the new model cannot map it 1:1. Prefer adapters and additive migration.

## Creation Workbench migration

Study `CreationWorkbench` carefully.

Preserve real capabilities such as:

- generation
- model selection
- prompt/draft logic
- character/scene/prop context selection
- generation gates
- permissions/quota

Migrate these capabilities into the new shot-driven Production experience. Avoid maintaining two separate full generation UX systems long-term.

## Production workspace

Production should answer: **which Shots are ready and which still need media?**

Show Scene/Shot production status and allow open/generate/regenerate/select version actions.

Prefer project/global generation defaults with per-shot overrides instead of forcing model selection on every shot every time.

## Final workspace

Do not build a full NLE/timeline editor in this refactor.

Final can initially provide:

- completion summary
- shot completeness
- selected final generations
- existing export/delivery capabilities
- missing-media warnings

Integrate real existing delivery features where present.

## Context-aware AI assistant

The AI assistant should understand current project/stage/scene/shot/selected entity and support structured safe actions when appropriate.

Examples:

- Story: `讓這一段更溫暖`
- Scene: `這一場不要太悲傷`
- Shot: `鏡頭再靠近一點`
- Character: `安倢不要戴眼鏡`

AI must not have arbitrary DB mutation power. Use validated action contracts and preview large/destructive/cascading changes.

## Realtime, permission and security

Preserve existing collaboration behavior and project route semantics.

Map collaboration zones into the new workspace instead of deleting realtime functionality.

All server mutations must retain existing authorization, edit permission, group access, quota and generation gates.

Never rely on UI-only permission checks.

Sanitize/validate AI and user-provided data. Never expose secrets/provider keys client-side.

## Responsive UX

This workspace must be usable on desktop, tablet and mobile.

Required mobile principles:

- no giant horizontal admin tables
- progressive disclosure
- 44px+ practical touch targets
- drawers/sheets instead of persistent side management panels
- no sticky-header/bottom-nav collisions
- keyboard-safe long-form story editing
- no horizontal overflow

Recommended visual checks: ~390, 430, 768, 1280 and 1440 widths.

## Design direction

Keep the existing AIOS brand/design tokens and primitives. Do not invent a disconnected design system.

The workspace should feel warm, creative and production-oriented—not like an ERP/database admin console.

Reuse existing UI primitives and icon system where possible.

## Legacy compatibility

Existing projects must not open as empty projects.

Add compatibility mapping/adapters so existing worldview, characters, costumes, scene data, props, knowledge, assets and generations remain reachable.

Prefer additive migrations and safe backfills.

If a destructive DB migration would be required with no safe compatibility path, stop and ask before proceeding.

## Performance

The current Project Page is heavy. Improve runtime shape while refactoring:

- avoid mounting heavy managers when their drawer/panel is closed
- use stage-level lazy loading when it helps
- query only the data required for the active workspace
- use targeted tRPC/Query invalidation
- avoid full project refetch on every edit
- avoid a new global mega-context

Use existing React + tRPC + TanStack Query architecture unless there is an overwhelming reason not to.

## Required validation

Use the real repo scripts and fix failures introduced by this refactor.

At minimum run:

```bash
npm run typecheck
npm run check:boundaries
npm run check:ui-primitives
npm run check:hooks
npm test
npm run test:client
npm run build
```

If DB schema/migrations change, also run the repository's migration dry-run/check commands.

Classify failures as pre-existing vs introduced. Do not report a check as passing unless it was actually executed successfully.

## Priority order

### P0 — must establish the real vertical slice

- Story Workspace
- persistent story
- AI structured parse contract
- entity resolution + uncertainty flow
- Scene model
- Shot model
- Story → Storyboard
- simplified stage navigation
- Project Context extraction
- existing-project compatibility

### P1 — complete after P0 is stable

- Character Looks
- Environment States
- reference assets
- project/scene/shot inheritance
- change preview
- revision/undo foundation
- shot-driven generation

### P2 — only after P0/P1 quality is acceptable

- richer sound/music metadata
- deeper camera pro controls
- version comparison
- smarter asset recommendations

Do not trade a complete P0 vertical slice for many half-built P2 features.

## Autonomous execution rules

This is a long-running implementation task.

Do not stop after audit or plan. Continue:

```text
AUDIT → PLAN → IMPLEMENT → MIGRATE → TEST → FIX → UX REVIEW → BUILD → REPORT
```

Only pause for user input when:

1. a destructive migration has no safe compatibility path;
2. real user data would need deletion;
3. a required secret/credential has no existing abstraction/fallback path;
4. two explicit product requirements are truly mutually exclusive.

Otherwise make a reasonable engineering decision, document it, and continue.

## Definition of Done

The refactor is not done because the screen looks cleaner. It is done when:

- `/p/:id` remains functional;
- existing projects still load real data;
- Story is the main entry;
- primary nav is Story / Storyboard / Production / Final;
- Project Context is secondary rather than blocking creation;
- story autosave works;
- structured AI parse is validated;
- uncertainty resolution works;
- Scene and Shot domains work;
- Story → Storyboard works;
- Shot editing works;
- Shot can reach the real generation flow;
- existing creation capabilities are preserved or deliberately migrated;
- knowledge/assets/recycle remain accessible;
- authorization/collaboration do not regress;
- mobile and desktop are usable;
- relevant tests/checks/build pass;
- no secrets or fake production features are introduced.

## Final implementation report

When implementation reaches a stable deliverable, update the PR description or add a concise report containing:

- completion percentage for P0/P1/P2
- architecture summary
- major files changed
- schema/migration details
- legacy compatibility mapping
- Auto Parse design
- actual test/build results
- known limitations
- recommended next step

Do not auto-merge this PR. Keep it reviewable until explicitly approved.
