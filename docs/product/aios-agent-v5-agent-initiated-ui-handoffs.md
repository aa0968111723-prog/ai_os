# Aios Agent v5 — Agent-Initiated UI Handoffs & Inline Selection Cards

## Problem

Aios currently reaches a valid clarification state such as:

> 「你說的雲端是 Google Drive、Google Photos，還是 Aios 目前專案素材？」

but often renders only prose. The user must manually leave the conversational flow, find `加入資料`, reopen a picker, re-select the source, and reconstruct context.

This breaks the Agent loop. The Agent understood the next required interaction but failed to present the interaction surface itself.

The product requirement is:

**If the Agent knows what user input/tool handoff is required next, it must render and/or launch that next step in context.**

The user should not have to manually search the app for a tool that the Agent already selected.

## Core interaction rule

`Agent determines missing slot / required handoff → server returns typed InteractionRequest → client renders the exact UI control → user responds in-place → result is attached to the same activeGoal/run → Agent resumes automatically.`

Do not use plain text clarification when the answer can be represented as a safe structured choice or picker.

## Typed InteractionRequest

Add a shared typed contract, e.g.:

```ts
interface AssistantInteractionRequest {
  interactionId: string;
  runId: string;
  goalId?: string;
  type:
    | "SOURCE_PICKER"
    | "FILE_PICKER"
    | "FOLDER_PICKER"
    | "DRIVE_PICKER"
    | "PHOTOS_PICKER"
    | "PROJECT_PICKER"
    | "ASSET_PICKER"
    | "SCENE_PICKER"
    | "SHOT_PICKER"
    | "MODEL_PICKER"
    | "CONFIRMATION_CARD"
    | "PERMISSION_CARD"
    | "BUDGET_CARD"
    | "HUMAN_INPUT_FORM";
  title: string;
  description?: string;
  required: boolean;
  options?: Array<{
    id: string;
    label: string;
    subtitle?: string;
    icon?: string;
    availability?: "AVAILABLE" | "DEGRADED" | "BLOCKED";
    blockerReason?: string;
  }>;
  capabilityId?: string;
  missingSlot?: string;
  resumeToken: string;
  expiresAt?: string;
}
```

IDs returned by the client remain context only. Server must re-resolve and ACL-check every submitted selection.

## UI behavior requirements

### 1. Source selection must be an inline card

For ambiguous `雲端`, render in the assistant card itself:

- Google Drive
- Google Photos
- Aios 專案素材
- 本機檔案

Each option must show live availability from capability health.

Unavailable sources remain visible but disabled with an honest reason, e.g. `Google Photos 尚未連線`.

Do not ask the user to type `Drive` or manually press `加入資料` unless no structured UI is technically possible.

### 2. Picker launch should be agent-initiated

If the user says:

- `從 Drive 加進來`
- `幫我選幾張圖`
- `加入檔案`
- `從手機選照片`

and source/target is sufficiently resolved, the Agent should directly launch the correct picker/handoff.

The desired flow is:

`user request → Agent resolves project/source → picker opens → user selects → intake persists → Agent resumes same run`.

Do not require:

`user request → Agent prose → user presses global + → user presses 加入資料 → user selects source → user repeats context`.

### 3. Picker must preserve Agent context

When opening a picker or mini-workspace, persist:

- conversationId
- runId
- goalId
- interactionId
- target projectId
- requested capability
- expected result type
- return context

When the picker completes, it must return typed result refs to the original run and automatically resume it.

Panel close, route change, picker open, and picker return must not create a new goal accidentally.

### 4. Quick chips are actions, not decorative suggestions

Buttons/chips such as `加入資料`, `繼續目前工作`, `做影片`, `安排工作` must either:

- execute a real low-risk capability,
- open the relevant structured handoff,
- or start a new explicit goal.

They must not just inject vague prompt text if the system already has a deterministic action available.

### 5. Clarification hierarchy

Use this order:

1. deterministic auto-resolution when exactly one safe valid option exists;
2. structured selection card when 2–6 meaningful candidates exist;
3. search/select picker when candidate set is large;
4. free-text clarification only when the missing information cannot be represented structurally.

### 6. Direct launch vs confirmation

Do not confuse `human input needed` with `permission needed`.

Examples:

- Choosing a Drive file: no confirmation dialog; show picker.
- Choosing a target project among three: inline selection card.
- Sending an external message: confirmation card before side effect.
- Paid generation: budget/confirmation card if policy requires.
- Read-only project search: execute directly.

### 7. Mobile-first interaction

On narrow/mobile screens:

- source options should be full-width or 2-column touch cards;
- minimum touch target 44px;
- primary next action remains visible without horizontal scrolling;
- no nested modal inside another modal when a sheet/card can work;
- picker return should restore scroll position near the active assistant step;
- selected items should show a compact preview and count;
- one obvious `繼續` / `完成選擇` action if needed.

The user should never need to manually hunt for a global `+` button to continue an active Agent workflow.

## Required interaction flows

### FLOW-A — Ambiguous cloud source

User: `雲端有多少素材？`

Expected UI:

Aios says briefly: `你要查哪個來源？`

Then immediately renders cards:

- Google Drive
- Google Photos
- Aios 專案素材

Tap Drive → same run continues. No retyping.

### FLOW-B — Drive import

User: `從 Drive 加幾張到北藝回顧`

Expected:

1. resolve project;
2. capability health confirms Drive availability;
3. open Drive picker automatically;
4. user selects files;
5. Universal Intake persists files;
6. return verified asset refs;
7. same activeGoal resumes;
8. Agent reports import result.

### FLOW-C — Local phone upload

User: `從手機加入三張照片`

Expected:

- native/browser file picker opens directly;
- accept image types where appropriate;
- multi-select enabled;
- selected files preview inline;
- upload progress shown;
- failed files are individually retryable;
- verified persisted assets return to same run.

### FLOW-D — Recent result continuation

User imports 5 files, then says `把這些放第三鏡`.

No picker should reopen unnecessarily.

Use `recentActionResults` → resolve third shot → attach → read-back verify.

### FLOW-E — Project ambiguity

If two or more valid target projects match, show project cards with title + useful disambiguation.

User taps one → server revalidates ACL → same goal resumes.

### FLOW-F — Capability unavailable

If Google Photos is not actually available:

- card remains visible but disabled;
- show `尚未連線` / `目前不可用`;
- provide one actionable alternative such as Drive, Aios assets, or local upload;
- never route the user into a dead UI.

## Runtime/event requirements

Public events should represent handoff truthfully:

- `interaction.requested`
- `interaction.presented`
- `interaction.submitted`
- `interaction.cancelled`
- `interaction.expired`
- `handoff.opened`
- `handoff.returned`
- `waiting.user_input`
- `agent.resumed`

`waiting.user_input` is not `completed`.

If the client cannot render a required interaction type, surface a recoverable error instead of silently downgrading to generic prose.

## Persistence / resumability

Interaction requests must be durable enough to survive:

- assistant panel close/reopen;
- route changes;
- picker navigation;
- accidental page refresh where the underlying durable run supports recovery.

A stale/expired interaction submission must be rejected server-side rather than applied to a newer goal.

## Security

- client selection IDs never grant authorization;
- all selected project/asset/file/shot ids are re-resolved server-side;
- external picker callbacks must bind to runId + interactionId/resumeToken;
- prevent callback replay;
- prevent source spoofing (e.g. a Local file result submitted as a Drive result);
- only capability-registered interaction types may be launched;
- do not expose provider secrets/tokens in client state.

## Telemetry / practicality metrics

Measure:

- `clarification_to_selection_ms`
- `interaction_render_success_rate`
- `picker_open_success_rate`
- `picker_return_success_rate`
- `handoff_resume_success_rate`
- `manual_tool_hunt_rate`
- `clarification_abandon_rate`
- `extra_taps_to_completion`

Target for core flows:

- manual tool hunt rate = 0;
- same-goal handoff resume success >= 99% in staging soak;
- common source/project clarification <= 1 explicit user tap after the Agent asks;
- no duplicate run created by picker return.

## Regression tests

Add automated coverage for:

1. ambiguous cloud → renders source cards;
2. tap Drive → returns same runId/goalId;
3. Drive unavailable → disabled card + honest blocker;
4. user says `從 Drive 加進來` with resolved project → picker opens without manual `加入資料`;
5. local upload → native file input opens and returns verified refs;
6. project ambiguity → selection card → correct server-revalidated project;
7. picker cancel → run remains waiting/recoverable, not failed/completed;
8. picker return after route change → resumes same run;
9. stale interaction callback → rejected;
10. recentActionResults flow avoids unnecessary picker;
11. waiting interaction never shows `Aios 已完成`;
12. mobile viewport has usable touch targets and no hidden required action.

## Definition of Done

This requirement is complete only when a user can stay inside the conversational Agent workflow for the full sequence:

`ask → choose source/project/file in contextual UI → tool executes → read-back verifies → Agent continues`.

If the user must manually discover and reopen a separate global tool that the Agent already knew it needed, the flow is not considered production-ready.
