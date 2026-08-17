# Phone AI Assistant Action-First v2 — 實作總計畫

> Status: implementation plan based on current default after merged PR #766 and #774.
>
> Product boundary: **Phone only `<768px`**. Tablet and desktop (`>=768px`) remain on the existing desktop product mode.
>
> Goal: keep the fast AI-first phone shell shipped in #766, but evolve the assistant from “a convenient way to open chat” into the phone product's **primary action control surface**: understand the current creative context, show only useful execution state, perform existing verified actions, render compact results, and hand the user into deeper tools only when necessary.

---

## 0. Baseline reconciliation — do not rebuild what #766 already solved

PR #766 is merged and already provides the correct phone foundation:

- one product breakpoint: `<768px = Phone UX`, `>=768px = Desktop UX`;
- `MobileHome` and `MobileProjectPage` as lightweight phone surfaces;
- current project / progress / continue-production flow;
- `MobileAiBar` using the existing assistant via `composeToAssistant()`;
- quick actions from existing `getAssistantQuickActions(pageCtx)`;
- one assistant owner per viewport, avoiding duplicate phone/desktop panels;
- lazy loading for the full workspace and non-critical global chrome;
- a compact `phone.project` projection instead of loading the full desktop project graph;
- major first-load and route payload reductions;
- phone browser coverage at 360 / 390 / 430 and tablet/desktop regression coverage.

Therefore **this plan must not create a second mobile assistant, a second router, another project data model, another chat runtime, or another phone shell**.

The remaining gap is above that foundation:

1. `MobileAiBar` is still primarily a compose bridge into the assistant sheet.
2. The user often has to read conversational prose to discover what happened.
3. Execution state is less visible than it should be on a small screen.
4. Cross-page creative actions can still feel like “AI tells me where to click” instead of “AI uses the existing capability and shows the result”.
5. Context exists in the system, but the phone UI does not always make the active project / shot / asset / goal obvious enough.
6. The current experience can surface technical activity, but the phone user needs **verified work progress**, not model chain-of-thought.

This v2 closes those gaps without undoing #766.

---

# 1. Product objective

On phone, a user should be able to open Aios and say something like:

- `把第二幕改成晚上，下雨，人物保持一致`
- `第三幕還缺什麼？`
- `把這個角色加入第三幕，再補三個分鏡`
- `繼續我剛剛做到一半的工作`
- `幫我找出還沒完成的鏡頭`

and receive a compact, truthful interaction such as:

```text
第二幕
✓ 找到目前專案與第二幕
✓ 已載入目前角色／Look／Scene 約束
◉ 準備修改：時間 → 夜晚、天氣 → 下雨

[預覽變更]
```

After user confirmation when required:

```text
已完成
✓ 第二幕設定已更新
✓ 受影響鏡頭：4
! 其中 3 鏡現用畫面已過時

[只處理這 3 鏡]   [查看第二幕]
```

The phone experience should optimize for:

> **one goal → visible plan → verified action → compact result → one obvious next step**

not:

> one goal → long assistant answer → user interprets it → user navigates manually → user performs the action again.

---

# 2. Hard invariants

## 2.1 One assistant runtime

Reuse the existing assistant stack and its current authority boundaries:

- `GlobalAssistantSheet`
- `AICreativeCopilot`
- existing assistant intent / GoalFrame / action system
- existing page-aware context registration
- existing `composeToAssistant()` bridge
- existing verified execution / confirmation rules
- existing active-goal / continuation semantics
- existing project / story / scene / generation / asset truth

Phone v2 is a **projection + interaction layer**, not AssistantV2.

## 2.2 Desktop and tablet must not change

- `<768px`: phone action-first UX may render.
- `>=768px`: existing desktop UX remains the product.
- No desktop redesign, navigation refactor, panel resize, typography change, or assistant behavior fork unless the behavior is a shared bug fix required by both surfaces.
- Reuse the desktop layout fingerprint protection introduced by #766.

## 2.3 No chain-of-thought UI

Do **not** expose hidden model reasoning.

Phone progress may show only user-legible, auditable facts derived from existing plan / tool / execution events, such as:

- `讀取目前專案`
- `找到第 3 幕`
- `檢查角色一致性資料`
- `等待你的確認`
- `已建立 3 個候選`
- `2 個完成，1 個失敗`

Never invent progress text merely to make the UI look active.

## 2.4 Verified execution only

A write action is “done” only when the existing runtime has verifiable success evidence.

Do not convert:

- a proposal into a write;
- a model claim into execution proof;
- a pending job into success;
- a generated candidate into current/adopted media;
- an approval-required action into an automatic spend.

Keep all existing ACL, revision/CAS, approval, points, idempotency, rights, Candidate/Compare/Adopt, and provider capability semantics.

## 2.5 No hidden paid cascade

If a phone action can spend points:

- disclose the action / estimated cost using existing server truth;
- require the same confirmation/approval path as desktop;
- never split one request into multiple hidden paid calls to make the experience appear “one tap”.

The UI can be simple while the economic boundary remains explicit.

---

# 3. Phone information architecture

## 3.1 MobileHome remains the start surface

Keep the #766 hierarchy, but upgrade the AI region into a goal launcher.

Order:

1. active / recent project
2. current progress / next work
3. primary `繼續製作`
4. **AI goal composer**
5. 2–4 contextual goal shortcuts
6. recent work only when useful

Suggested top copy:

`今天想完成什麼？`

The user should not need to know which Aios module owns the operation.

## 3.2 MobileProjectPage gains an explicit context capsule

Above or directly adjacent to the AI composer, show only the active context needed to understand pronouns such as “這張 / 這幕 / 這個角色”.

Example:

```text
百日夢島
第二幕 · Shot 03
角色：魯夫、娜美
```

Rules:

- derived from existing registered page / project / selection context;
- no new source of truth;
- collapse when no specific shot/asset is selected;
- never show UUIDs;
- tap may reveal one compact context sheet, not navigate to a settings maze.

## 3.3 Persistent phone composer

The composer remains reachable while the user is reviewing an assistant result.

It should support existing input capabilities without forcing new infrastructure. Before adding image/file/voice controls, audit what the current assistant composer can actually receive. Only expose a control when the same runtime can consume it truthfully.

If an input type is unsupported, omit it rather than adding a dead icon.

---

# 4. Action-first response model

The phone assistant should render four primary response shapes.

## 4.1 Answer Card

For informational requests where no action is needed.

Example:

```text
第三幕完成度 72%

缺：2 個畫面
待確認：1 個角色造型
完成：腳本、鏡頭、旁白

[幫我補缺少的部分]
```

Use structured server/project data where available. Do not ask the LLM to recompute canonical completion state if a server projection already exists.

## 4.2 Proposal Card

For a requested change that requires user review before write.

Example:

```text
準備修改第二幕
時間：白天 → 夜晚
天氣：晴 → 雨
人物／Look：保持不變
影響：4 鏡

[套用變更]
```

This is still a proposal until the existing confirmation/action path executes it.

## 4.3 Work Progress Card

For an existing agent run / long operation.

Show only real stages available from durable or verified execution state:

```text
補完第三幕
✓ 分析 6 鏡
✓ 4 鏡已有畫面
◉ 2 鏡等待生成核准

[查看核准內容]
```

No fake percentages. Prefer counts and named stages.

## 4.4 Result Card

After verified execution:

```text
已更新第二幕
4 鏡受到影響
3 鏡現用畫面需要重新確認

[處理這 3 鏡]
```

The result card must provide one primary next action derived from actual state.

---

# 5. Mobile Assistant Projection

Create a phone-oriented projection from existing assistant / project / run truth instead of letting each component reconstruct status separately.

Conceptual shape (final names depend on baseline audit):

```ts
interface PhoneAssistantProjection {
  context: {
    projectId?: string;
    projectName?: string;
    storySceneId?: string;
    storySceneName?: string;
    shotId?: string;
    shotLabel?: string;
    assetId?: string;
    focusLabel?: string;
  };
  activeGoal?: {
    goalId: string;
    title: string;
    status: "planning" | "needs_confirmation" | "running" | "partial" | "done" | "failed";
    steps: Array<{
      label: string;
      state: "done" | "active" | "pending" | "blocked" | "failed";
      evidenceRef?: string;
    }>;
    primaryAction?: PhoneAssistantAction;
    secondaryAction?: PhoneAssistantAction;
  };
  result?: PhoneAssistantResult;
}
```

This is a **view model**. Do not persist it as a competing truth table unless the baseline audit proves a durable fact currently has no home.

Prefer:

- derive current context from existing page/focus registrations;
- derive goal/run state from existing assistant / agent run state;
- derive completion / stale / generation / review state from existing server projections;
- derive actions from existing capabilities and confirmation policies.

---

# 6. Context resolution — make “this / here / continue” reliable

The phone assistant must reliably resolve:

- current project;
- current story scene / section;
- selected shot;
- selected asset/candidate where applicable;
- active goal;
- recent verified results;
- focus layer registered by the current screen.

Priority should be deterministic and shared with the existing assistant semantics, not a phone-only guess.

Suggested precedence:

```text
explicit IDs/entities in request
→ active user selection
→ registered page focus context
→ active goal context
→ current project
→ recent verified result only when the user clearly refers to it
```

Ambiguity rule:

- if two destructive/write targets are plausible, ask or present a target chooser;
- never “pick the first shot” silently;
- read-only questions may return a bounded comparison when helpful.

Continuation examples that must work:

1. `把第三幕補完`
2. later: `第二個不要，換成晚上`
3. later: `就用這個`

The active goal must preserve enough typed context that the phone user does not need to restate the project and target every turn.

---

# 7. From chat routing to capability routing

The LLM does not become an unrestricted app controller.

Use a typed route:

```text
User goal
  ↓
Existing request classification / GoalFrame
  ↓
Context resolution
  ↓
Capability lookup
  ↓
Proposal / confirmation if required
  ↓
Existing action/tool execution
  ↓
Verified execution evidence
  ↓
Phone result projection
```

## Capability contract

Each phone-visible action should be backed by an existing capability descriptor or a thin adapter to an existing action.

At minimum the action projection needs to know:

- can it execute or only advise?
- read vs write;
- paid vs free;
- requires confirmation / approval?
- target IDs;
- success evidence type;
- deep-link target after success;
- whether opening the full workspace is necessary.

Do not use route navigation itself as proof that a task was done.

---

# 8. One-sentence cross-page operations

A major v2 acceptance target is that the user can request work spanning multiple existing modules without manually opening each one.

Example:

`把這個角色加入第三幕，補三個分鏡，保持前兩幕畫風一致`

The assistant may internally use existing character binding, story/scene mutation, storyboard, consistency, and generation planning capabilities, but phone UX should present one coherent goal.

Important boundaries:

- each durable write still uses its existing server authority;
- if the request includes paid generation, stop at the existing confirmation/approval boundary;
- partial success is explicit;
- failure in step 3 must not pretend steps 1–2 rolled back unless a real transaction did so;
- do not create a generic “super mutation” that bypasses existing invariants just to reduce UI steps.

---

# 9. Progressive disclosure instead of giant answers

Default phone assistant output should be compact.

Prefer:

- title
- 1–3 state lines
- one primary CTA
- optional secondary action
- `查看詳情` for diagnostics

Move these behind detail disclosure unless they are blocking:

- provider names;
- packet IDs;
- fingerprints;
- internal run IDs;
- raw tool payloads;
- full consistency diagnostics;
- long action logs.

The user should see technical details only when they need to debug or verify.

---

# 10. Full workspace handoff

The assistant should open the heavy desktop-derived work surface on phone only when the user actually needs manual precision.

Examples that justify deep workbench load:

- compare visual candidates side by side;
- fine-tune shot camera/performance details;
- draw/annotate;
- edit long story text;
- resolve an ambiguous multi-asset choice;
- inspect a technical failure.

Examples that should **not** require full workspace load:

- asking completion state;
- changing a simple scene state with a safe typed action;
- continuing an existing run;
- approving a clearly summarized action through the existing approval UI;
- checking what is missing;
- opening a verified result preview.

Preserve #766's lazy-loading budget: do not import the full project workbench simply because an assistant card renders.

---

# 11. Performance budgets

Phone v2 must preserve or improve the #766 baseline.

Hard requirements:

- no eager import of the full project workspace from `MobileHome`, `MobileProjectPage`, or result cards;
- no per-card N+1 assistant status queries;
- no additional polling loop for hidden phone chrome;
- use a compact bounded projection for active goal/result state;
- keep large diagnostics lazy;
- do not download desktop-only assistant UI on phone if a phone-specific view can consume the same state without it;
- do not regress `/p/:id` phone route into loading the full project graph on entry.

Record before/after:

- initial gzip JS for `/dashboard` and `/p/:id`;
- JS downloaded by opening a project;
- API procedure count for opening a project;
- assistant-open incremental chunk size;
- result-card rendering query count.

Any regression must be explained and justified by measurable product value.

---

# 12. Accessibility and phone interaction

At 360 / 390 / 430 widths:

- all primary touch targets >=44px unless an existing documented inline-text exception applies;
- no horizontal page overflow;
- keyboard must not cover the composer or primary confirmation CTA;
- screen reader names for icon-only actions;
- focus returns sensibly after closing a sheet/detail view;
- progress status uses accessible text, not color alone;
- dynamic result/progress updates use a restrained live-region strategy so screen readers are not spammed by every minor event.

At 768 / 820 / 1024 / 1280 / 1440:

- phone-only action cards / composer chrome do not leak into desktop mode;
- existing desktop assistant owner remains single;
- desktop layout fingerprint remains unchanged unless a shared bug fix is explicitly documented.

---

# 13. Error, partial success, offline, and stale context

## 13.1 Partial success

Render reality:

```text
完成 2 / 3
✓ 已加入角色
✓ 已建立分鏡
! 生成候選等待核准
```

Do not collapse this to `完成`.

## 13.2 Stale context

If the user had Shot 03 selected, another collaborator deleted/moved/changed it, and a later command refers to `這一鏡`:

- re-resolve current authority before write;
- show the updated target or a conflict message;
- never execute against a stale cached client projection just because the chat still remembers it.

## 13.3 Network interruption

If execution is durable server-side:

- reconnect should rehydrate the real run state.

If an operation was never accepted by the server:

- say it was not submitted / needs retry.

Do not manufacture a success state from optimistic UI alone.

---

# 14. Suggested implementation stack

Implement as small stacked Draft PRs. Do not ship one giant mobile/assistant rewrite.

## PR-A — Phone Assistant Projection + Action Cards

Scope:

- baseline audit of current assistant state, active goal, context registration, `MobileAiBar`, `GlobalAssistantSheet` and `phone.project`;
- add a phone-oriented derived view model;
- context capsule;
- Answer / Proposal / Work Progress / Result card primitives;
- map existing truthful states into cards;
- no new write capability yet.

Definition of Done:

- user can see current project/shot context without reading a transcript;
- existing long runs display real stage/count state;
- existing completion/read-only answers can render as compact cards;
- no duplicate source of truth;
- desktop unchanged.

## PR-B — Action-first Execution Bridge

Scope:

- capability descriptor for phone-visible existing actions;
- typed `primaryAction` / `secondaryAction` projection;
- direct execution through existing assistant/action paths;
- confirmation/approval handoff;
- verified result evidence;
- continuation / correction targeting tests.

Definition of Done:

- safe free writes can complete without manual page navigation when an existing capability supports them;
- paid/high-risk writes stop at existing approval/confirmation;
- result cards never claim success before verified execution;
- ambiguous targets do not silently execute.

## PR-C — Cross-page Goals + Full-workspace Handoff

Scope:

- multi-step existing-capability orchestration for bounded creative goals;
- partial-success projection;
- one primary next action;
- open precise deep tool only when needed;
- preserve lazy loading.

Definition of Done:

- at least the golden cross-page flows in §16 work without the user manually traversing module pages;
- no “super mutation” bypassing existing service boundaries;
- full workspace remains lazy until a precision-edit action requires it.

## PR-D — Phone Golden Flows, Performance, A11y, Regression

Scope:

- browser flows at 360 / 390 / 430;
- tablet/desktop leakage tests;
- payload/API budgets;
- keyboard / safe-area / focus / live-region checks;
- failure/reconnect/partial-success fixtures;
- desktop layout fingerprint comparison.

Definition of Done:

- introduced regressions = 0;
- budgets are recorded, asserted, and mutation-tested where practical;
- no test passes simply because a precondition silently failed.

---

# 15. Files / areas to audit before coding

The implementation agent must first locate the current responsibilities around:

- `client/src/mobile/MobileHome.tsx`
- `client/src/mobile/MobileProjectPage.tsx`
- `MobileAiBar`
- `GlobalAssistantSheet`
- `AICreativeCopilot`
- assistant compose bridge / pending compose ownership
- `getAssistantQuickActions`
- page-aware assistant context registration
- active GoalFrame / continuation state
- verified execution events / assistant tool-action result handling
- agent run progress projection
- `phone.project`
- story/project completion projection
- project context navigation / deep-link anchors
- Candidate / Compare / Adopt UI boundaries
- approval and points confirmation paths
- current mobile browser verification added by #766

If the exact implementation has moved since #766, follow the current code, not the historical path name.

---

# 16. Golden acceptance flows

Use deterministic fixtures and existing mock/provider-safe test paths. Do not call paid providers.

## Flow A — Context-aware edit

Starting state: project open, Scene 2 visible/selected.

User:

`改成晚上，下雨，人物保持一致`

Expected:

1. resolves Scene 2 from current context;
2. proposal card shows only intended environment changes;
3. character/Look stays unchanged;
4. impact count is shown when available;
5. write requires the normal confirmation policy;
6. verified result card appears after success;
7. stale/affected shots are reported from server truth.

## Flow B — “What is missing?”

User:

`第三幕還缺什麼？`

Expected:

- read-only;
- compact completion card;
- no long essay;
- no workspace load;
- one useful next action such as `補缺少的部分`.

## Flow C — Continue active goal

Start an operation that pauses for approval or has multiple durable stages.

User later returns and says:

`繼續剛剛的`

Expected:

- active typed goal/run is resolved;
- real stage is restored after reload;
- no duplicate paid operation or duplicate write;
- card resumes from persisted truth.

## Flow D — Cross-page creative goal

User:

`把這個角色加入第三幕，補三個分鏡，保持前兩幕畫風一致`

Expected:

- current character context resolves;
- existing capabilities perform or propose each bounded step;
- paid generation stops at approval;
- partial success is visible;
- user is not forced through character page → story page → storyboard page manually.

## Flow E — Correction

After a proposal with three items:

`第二個不要，改成夜景`

Expected:

- modifies the active proposal/goal context;
- does not accidentally target “second shot” unless that is the typed meaning;
- preview updates before execution.

## Flow F — Ambiguous destructive target

User:

`刪掉這個`

with two plausible selected/recent entities.

Expected:

- does not execute;
- presents a target clarification/chooser;
- no server write occurs.

## Flow G — Partial failure

Three-step task where step 3 fails deterministically.

Expected:

- UI says 2/3, not success;
- verified results from steps 1–2 remain visible;
- retry targets only the failed step when idempotency contract allows;
- no duplicate writes or charge.

---

# 17. Success metrics

This v2 is successful when phone use measurably becomes action-first.

Measure with golden fixtures where possible:

- median taps from natural-language goal to confirmed action;
- manual route changes required for Flow A/B/C/D;
- percentage of supported goals that end in a structured result card rather than prose-only output;
- time-to-visible-first-useful-state after opening the assistant;
- phone initial JS/API budgets vs #766 baseline;
- accidental full-workspace loads;
- ambiguous-target prevented-write count in tests;
- duplicate-execution / duplicate-charge regression count = 0.

Do not optimize for “number of AI messages”. Fewer, more actionable messages is a positive outcome.

---

# 18. Non-goals

Do not use this project to:

- redesign desktop;
- add tablet-specific UX;
- replace #766 phone shell;
- build AssistantV2 / AgentV2 / RouterV2 in parallel;
- create a second project/shot completion model;
- expose chain-of-thought;
- auto-approve paid generation;
- silently Adopt candidates;
- rebuild story/scene/asset APIs merely to make phone code look cleaner;
- add dead voice/image/file icons before input capability exists;
- preload the complete project workbench;
- turn the assistant into an unrestricted DOM-clicking robot.

---

# 19. Final Definition of Done

The implementation stack is complete only when all of the following are demonstrated:

1. Phone users can treat AI as the primary goal entry point.
2. The active project / scene / shot context is obvious and reliably resolved.
3. “this / here / continue / second one” continuation semantics are typed and tested.
4. The assistant renders compact answer/proposal/progress/result cards on phone.
5. Progress comes from real auditable state, not chain-of-thought or fake percentages.
6. Existing supported actions can execute without manual cross-page navigation.
7. Every write still passes existing ACL/revision/confirmation policy.
8. Paid actions still use existing estimate/approval/points/idempotency paths.
9. Candidate output is never silently Adopted.
10. Partial failure is represented truthfully.
11. Reload/reconnect restores durable work state where the backend accepted the work.
12. Ambiguous destructive actions do not guess a target.
13. The full workspace loads only when deep manual editing is actually needed.
14. Phone payload/query budgets do not materially regress without explicit evidence and justification.
15. 360/390/430 golden browser flows pass.
16. 768/820/1024 remain desktop product mode.
17. 1280/1440 desktop layout fingerprint remains unchanged.
18. No second assistant, second router, or second source of truth is introduced.
19. No fake provider/DB/execution success is reported in tests or PR body.
20. A user can complete the golden cross-page goal primarily by stating intent, reviewing the plan/result, and pressing the one relevant next action.

---

# 20. Execution instruction for the implementation agent

Use this document as the authoritative scope.

Before changing code:

1. start from the latest default branch;
2. read merged #766 in full and treat it as the baseline, not work to redo;
3. inspect current assistant architecture and reconcile any path/name changes since #766;
4. inspect open PRs touching the same files before editing;
5. implement PR-A → PR-D as stacked Draft PRs or smaller if the current architecture naturally allows it;
6. do not stop at another plan after this document;
7. preserve all existing safety, cost, revision, Candidate/Adopt, rights and idempotency invariants;
8. do not call paid providers for acceptance testing;
9. run targeted tests plus typecheck/build/gates and real browser flows where available;
10. finish with actual PR numbers, exact test results, payload/API before-after numbers, and any genuine external blockers.
