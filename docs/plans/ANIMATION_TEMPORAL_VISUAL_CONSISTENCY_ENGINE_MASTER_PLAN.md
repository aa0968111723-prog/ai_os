# Animation Temporal & Visual Consistency Engine — Master Plan

> Status: authoritative implementation plan after PR #774.
>
> Goal: evolve Aios from “the same Canon / packet was sent to the model” into “the generated animation is actually coherent across story, appearance, motion, style, props, space, and time, and the animation team only sees the shots that need action.”

---

## 0. Why this is the next layer

PRs #752–#770 established the production-wide consistency backbone: Project/Team Canon, immutable versions, project pins, Scene Package, Character Slots, Shot Context Packet, provider-aware reference mixing, continuity state, Candidate/Compare/Adopt, lineage, targeted stale, Style/Voice/Sound World runtime, prop transfer, multi-character routing, server-authoritative consistency scorecard, repair UX, rights and delivery gates.

PRs #773–#774 then added animation-team multi-shot proof and aligned the E2E flow with explicit Adopt. The current test proves that the same world/character/scene/prop anchors and continuity snapshots are carried consistently across shots, and that multi-reference edit models are required when actual character reference images must be sent.

That is necessary, but it is not sufficient for finished animation.

The remaining production problem is **output truth**:

- the prompt can be correct while a face still drifts;
- the correct prop can be referenced while its shape/details change;
- a Look can be correctly bound while the generated costume changes color;
- a scene can carry the same Canon while lighting/rendering style changes;
- the previous end state can be structurally known while the next shot visually jumps;
- the action text can be correct while body mechanics, hand contacts, screen direction or momentum are physically implausible;
- a shot can be individually acceptable but still break sequence continuity.

Therefore the next system must evaluate and repair **the generated result**, not merely verify that its inputs were consistent.

---

# 1. Product objective

Build one integrated **Animation Temporal & Visual Consistency Engine** with four server-authoritative consistency layers:

1. **Semantic Consistency** — story facts and intended entities/states remain correct.
2. **Visual Consistency** — identity, Look, scene, prop and rendering style remain recognizably the same.
3. **Temporal Consistency** — Shot N end state flows into Shot N+1 start state unless the script authorizes a discontinuity.
4. **Physical Consistency** — body motion, object interaction, direction, contact, momentum and spatial relationships remain plausible.

The animation team should not have to understand packet IDs, fingerprints, Canon version IDs, adapters, model capability matrices or lineage internals.

The primary UX should answer only:

- What is wrong?
- Which shots are affected?
- Why is it considered wrong?
- Can the system repair only those shots?
- What will be regenerated and what will remain unchanged?
- What does the previous/next shot look like for comparison?

No global fake “consistency 93%” score. Use dimension-specific findings and evidence.

---

# 2. Hard architectural invariants

## 2.1 No second source of truth

Reuse existing authoritative records wherever semantics already exist:

- Character identity → existing character + Canon/version/pin path.
- Character Look → existing CharacterLook + Canon/version/pin path.
- Scene identity/environment → existing ScenePreset / Scene Package / Canon.
- Prop identity/owner → existing prop + Canon / continuity state.
- Style → existing style Canon.
- Voice/Sound World → existing voice/sound_world Canon.
- Shot intent → existing scene/shot record + frozen Shot Context Packet.
- Current output → existing Candidate/current explicit Adopt semantics.
- Media lineage → existing assets / generations / asset revisions / shotLineage.
- Staleness → derived from dependencies, never a competing persisted boolean.

Only persist genuinely new facts that do not currently have an authoritative home, such as durable **output-evaluation evidence** or explicitly approved **sequence-level lock snapshots** if the baseline audit proves they cannot be represented by existing Scene Package/Canon structures.

## 2.2 Explicit human authority remains

- Never silent-Adopt a candidate.
- Never silently Promote a Canon version.
- Never silently upgrade project pins.
- Never silently regenerate paid media.
- Evaluators may recommend `keep`, `review`, `repair`, or `block_adopt`; only humans move the current pointer.

## 2.3 Frozen intent vs mutable rights

Preserve the existing model:

- historical packet = frozen intent;
- execution rights = revalidated at execution;
- evaluator must evaluate against the exact packet / Canon versions / source frame lineage that the generation used, not the latest live project state unless it is explicitly doing a staleness comparison.

## 2.4 Honest model capability

A model that cannot consume the required reference role must not be described as “locked”.

The engine must distinguish:

- requested reference roles,
- model-supported reference roles,
- references actually attached,
- evaluation evidence available after generation.

---

# 3. Baseline audit required before implementation

Implementation must begin from the latest default branch **after #774** and first map the exact current responsibilities of:

- `shot_continuity_states`
- `scene_packages` / heads
- Shot Context Packet / heads
- `deriveShotEndState`
- `inheritContinuityState`
- script-authorized change parsing
- `story.continuityCheck`
- `buildConsistencyScorecard`
- `creativeContext.workspace`
- `creativeContext.shotLineage`
- Candidate/current/Adopt path
- reference mixer + provider capability matrix
- `generation.preview` / generation request preparation
- asset revisions / parent lineage
- Style Canon resolution
- current animation-team E2E added in #773/#774

The implementation PR must include a short reconciliation note showing which planned concepts already exist and are being extended rather than recreated.

---

# 4. Unified state model: Shot Start → Action → Shot End

## 4.1 Extend continuity from coarse state to production state

The existing continuity state already handles important facts such as Look/state changes and prop ownership. Extend it conservatively to represent animation-critical state when the source is known.

Candidate fields, subject to baseline audit:

### Character temporal state

- `characterId`
- `lookId`
- `screenPosition`: left / center / right or normalized x/y when derived from approved visual evidence
- `facingDirection`: screen-left / screen-right / toward-camera / away / unknown
- `gazeTarget`: character/prop/scene target ID or unknown
- `bodyPoseClass`: standing / walking / running / sitting / kneeling / lying / reaching / holding / unknown
- `handOccupancy`: left/right hand → prop ID / empty / unknown
- `wetness`, `dirt`, `injury`, other already-supported story states
- `emotionState` only when explicitly script/shot-authored or human-approved; do not infer as truth from a weak model guess

### Prop temporal state

Identity remains in existing prop/Canon truth; continuity carries changing state only:

- owner / holder
- visible / hidden / lost
- open / closed / folded / unfolded
- dry / wet
- intact / damaged / torn
- approximate screen position when evidence exists

Never store generated appearance as a replacement for Canon identity.

### Scene temporal state

- environment/time/weather already represented by Scene Package/Canon where applicable
- axis / screen direction when explicitly set or safely derived
- character relative ordering (A left of B, B behind A) when known
- persistent object placements only for objects that are narratively or compositionally relevant

Unknown remains `unknown`; never invent precise state to make the graph look complete.

## 4.2 State transition contract

Every material shot conceptually becomes:

```text
Previous Adopted End State
        ↓
Inherited Start State
        ↓
Script-authorized changes + Shot Action
        ↓
Expected End State
        ↓
Generated visual/video evidence
        ↓
Observed End State (evidence, not Canon truth)
        ↓
Human Adopt
        ↓
Approved End State feeds next shot
```

Keep **Expected** and **Observed** distinct. An evaluator mismatch must not overwrite expected story truth.

## 4.3 Transition exemptions

Existing time-jump / montage / explicit scene-change semantics remain authoritative. Extend only when required:

- hard cut alone does not automatically reset character/prop state;
- new location may reset spatial axis but not character identity, Look or held props;
- montage/time jump may release pose/position constraints while preserving identity and script-persistent states;
- explicit costume change resets Look continuity but not identity;
- explicit handoff changes holder/hand occupancy only when resolved unambiguously.

---

# 5. Sequence Lock — continuity above the individual shot

Individual Shot Packets are necessary, but animation production also needs a stable sequence/scene-level “what must remain true throughout this run of shots” layer.

## 5.1 Sequence Lock contents

Prefer deriving this from existing Scene Package + pinned Canon + sequence metadata. Add a new durable snapshot only if no current structure can represent the approved sequence contract without mutating historical packages.

A Sequence Lock should freeze or reference:

- active characters and approved identity versions
- active Looks by character
- scene identity
- environment state (time/weather/lighting intent)
- active props and their starting owners/states
- Style Canon version
- sound world version
- palette/rendering constraints
- screen-direction / axis rule where intentionally established
- sequence-level narrative goal
- reference assets approved for the sequence

## 5.2 Sequence lifecycle

States should be human-understandable, not technical:

- `ready`
- `needs_confirmation`
- `changed_upstream`

Do not create a second “current version” pointer if Scene Package/Canon pins already provide it. Prefer a derived projection.

## 5.3 Targeted blast radius

Changing one sequence constraint must calculate affected Shot IDs using the existing dependency graph.

Examples:

- change Look for Character A → only shots in the sequence using Character A + old Look
- change palette/style → only shots depending on that style version
- change prop identity → only shots using that prop
- change spatial axis manually → shots participating in the axis continuity chain

Current adopted media remains visible until explicit replacement is adopted.

---

# 6. Motion & Physics Continuity Engine

This layer judges whether motion is plausible and continuous, without pretending to be a full rigid-body simulator.

## 6.1 Motion representation

Create a compact, provider-independent motion contract per shot, derived from existing authored action/camera/performance fields plus approved visual observations:

```ts
interface ShotMotionContract {
  shotId: string;
  subjects: Array<{
    characterId: string;
    startPose?: PoseClass;
    endPose?: PoseClass;
    startFacing?: ScreenDirection;
    endFacing?: ScreenDirection;
    movement?: "stationary" | "walk" | "run" | "jump" | "sit" | "stand" | "reach" | "turn" | "fall" | "other";
    movementDirection?: ScreenDirection;
    heldProps?: Array<{ propId: string; hand?: "left" | "right" | "both" | "unknown" }>;
    contacts?: Array<{ targetType: "prop" | "character" | "surface"; targetId?: string; phase?: "start" | "during" | "end" }>;
  }>;
  camera?: {
    movement?: string;
    axisId?: string;
    screenDirectionRule?: string;
  };
}
```

This is a frozen/derived contract for evaluation and prompting; it is not a second authoring UI.

## 6.2 Physics findings

Support structured findings such as:

- `hand_swap_unexplained`
- `prop_teleport`
- `contact_missing`
- `body_pose_jump`
- `screen_direction_flip`
- `axis_break_unapproved`
- `position_jump`
- `motion_discontinuity`
- `velocity_direction_break`
- `object_state_break`
- `limb_integrity_suspect`

Severity depends on confidence and source evidence:

- blocker only when the mismatch is high-confidence and violates a hard authored/approved constraint;
- warning when evaluator confidence is limited;
- unresolved when evidence is insufficient.

Never block solely because a vision model “feels” that animation is odd without traceable evidence.

## 6.3 180° rule and screen direction

The system should support, not over-enforce, cinematic grammar.

- If an axis is intentionally established and not reset, a screen-direction flip becomes a finding.
- If the shot explicitly crosses the line, contains a neutral axis-reset shot, or the director marks the change as intentional, no finding.
- Axis state must be explicit/approved or confidently derived from adopted frames; do not manufacture it from text alone.

---

# 7. Asset Identity vs Asset State

Props and recurring visual assets must follow the same conceptual split already used for Character Identity vs Look.

## 7.1 Asset Identity (stable)

Stored in existing prop/Canon truth:

- silhouette / proportions
- material
- defining marks
- logo/symbol/pattern when rights permit
- unique damage/shape details that are part of the Canon identity
- approved reference images

Example: a treasure map can have a stable torn lower-right corner, red X position and coastline pattern.

## 7.2 Asset State (mutable across shots)

Stored/derived in continuity state:

- folded/unfolded
- dry/wet
- intact/torn
- closed/open
- on-table/in-hand/lost
- current holder

A state change must not cause the evaluator or generator to treat it as a different asset identity.

## 7.3 Visual asset drift findings

Evaluator findings can include:

- `prop_identity_drift`
- `prop_detail_missing`
- `prop_material_drift`
- `prop_color_drift`
- `prop_state_mismatch`
- `prop_owner_mismatch`

The finding must point to the Canon/approved reference evidence and affected shot.

---

# 8. Style DNA — style as measurable dimensions, not one prompt sentence

The existing Style Canon remains the authoritative style source. Extend its descriptor/version payload in a backward-compatible, conditional way so old fingerprints remain stable when no new fields exist.

## 8.1 Style DNA dimensions

Suggested structured dimensions:

### Rendering
- line treatment / line weight class
- brush/pencil/ink characteristics
- shading mode: cel / painterly / soft / flat / mixed
- texture/grain
- edge softness

### Color
- palette anchors
- saturation range
- contrast intent
- skin-tone treatment
- shadow hue tendency

### Lighting
- key-light direction policy when relevant
- hard/soft light
- bloom/rim-light policy
- exposure/highlight behavior

### Character rendering
- facial proportion language
- eye rendering
- hair grouping/detail level
- skin rendering

### Environment rendering
- background detail level
- atmospheric perspective
- material detail policy
- depth-of-field policy

### Cinematography language
- preferred focal length bands
- composition habits
- close-up vs wide-shot treatment
- camera movement vocabulary

These fields are optional. Existing free-text style remains supported.

## 8.2 Style output evaluation

After generation, compare candidate output against:

1. Style Canon reference(s), and
2. a bounded sample of **adopted sequence frames** from the same Style Canon version.

Do not let one anomalous previous frame redefine the style. Canon remains the primary reference; adopted frames provide empirical sequence context.

Structured style findings:

- `line_style_drift`
- `shading_style_drift`
- `palette_drift`
- `lighting_style_drift`
- `character_rendering_drift`
- `environment_rendering_drift`
- `cinematography_style_drift`

## 8.3 Style adapter boundary

Style LoRA/adapter runtime is a later implementation slice, not a prerequisite for the evaluator.

If implemented:

- Style adapter must be a separate role from Character Identity adapter.
- Provider capability must explicitly support the adapter slot.
- It must use the same Style Canon version / rights / lineage rules.
- Never silently replace a character adapter or user-specified adapter.

---

# 9. Cross-shot Reference Propagation

Canon answers “what this should be”. The previous adopted frame answers “what it actually looked like one moment ago”. High-quality animation needs both.

## 9.1 Reference roles

Extend the existing role-aware mixer rather than adding a parallel mechanism.

Potential additional roles:

- `continuity_previous_frame`
- `continuity_previous_end_frame`
- `sequence_style_frame`
- `composition_reference`

Keep current roles for identity/look/scene/prop/style.

## 9.2 Reference ordering policy

For a shot where visual continuity matters, construct references in role priority appropriate to model capability, for example:

1. character identity refs
2. active Look refs
3. previous adopted end frame / previous current frame
4. scene ref
5. prop ref
6. style ref
7. composition ref

Actual order/count must remain provider-aware and the mixer must report dropped roles.

## 9.3 Previous-frame safety

Never allow the previous frame to override Canon identity silently.

If the previous adopted frame itself contains a known drift finding:

- it may be excluded from continuity propagation, or
- included with an explicit warning and lower priority,

according to a deterministic policy.

## 9.4 Frame lineage

Every propagated frame must be traceable to:

`shot → adopted asset → generation → source/parent asset → packet → Canon dependencies`

Reuse existing media lineage / asset revisions. No opaque copied image blobs without lineage.

---

# 10. Start Frame / End Frame continuity

## 10.1 End-frame extraction

For video assets, support a durable derived frame asset representing a selected end frame when provider/output permits.

Requirements:

- derived asset has parent video lineage;
- frame timestamp is recorded;
- extraction is idempotent;
- it does not become Canon automatically;
- extraction failure does not corrupt Adopt.

## 10.2 Next-shot start guidance

When Shot N is adopted and Shot N+1 has no authorized continuity break:

- use Shot N observed/approved end state;
- optionally attach the end-frame reference when the selected model supports it;
- include expected Shot N+1 start-state constraints;
- report capability downgrade when the model cannot consume the frame.

## 10.3 No automatic paid cascade

Adopting Shot N may mark Shot N+1 as “continuity context updated” or stale if the packet dependency semantics require it, but must not automatically spend points to regenerate Shot N+1.

---

# 11. Multimodal Visual Consistency Judge

This is the core new output-truth layer.

## 11.1 Inputs

Evaluate a candidate using a bounded evidence bundle:

- exact frozen Shot Context Packet used for generation
- Character Canon refs / active versions
- Look refs / active versions
- Scene refs / Scene Package
- Prop refs / states
- Style Canon refs / Style DNA
- previous adopted frame/end frame when continuity applies
- candidate image, or sampled video frames
- model/generation lineage

## 11.2 Outputs

Use a structured result, for example:

```ts
interface AnimationConsistencyEvaluation {
  generationId: string;
  shotId: string;
  evaluatorVersion: string;
  evidenceFingerprint: string;
  dimensions: {
    semantic: EvaluationDimension;
    identity: EvaluationDimension;
    look: EvaluationDimension;
    scene: EvaluationDimension;
    prop: EvaluationDimension;
    style: EvaluationDimension;
    temporal: EvaluationDimension;
    physics: EvaluationDimension;
  };
  recommendation: "keep" | "review" | "repair" | "block_adopt";
  findings: StructuredFinding[];
}
```

Each finding must include:

- code
- dimension
- severity
- human-readable reason
- evidence source IDs
- affected character/prop/scene IDs when applicable
- confidence bucket (not fake precision)
- repair hint

## 11.3 Confidence policy

Use buckets such as:

- `high`
- `medium`
- `low`
- `insufficient_evidence`

Do not expose fake `0.8732` certainty as product truth unless the underlying evaluator has a calibrated metric with evidence.

## 11.4 Adopt policy

Recommended default:

- high-confidence hard semantic/identity/prop ownership violation → block Adopt until explicit override path or regeneration, depending existing product safety rules;
- style/physics/temporal drifts → review/warning by default unless the project marks them as hard constraints;
- low-confidence visual finding → warning only;
- evaluator unavailable → Candidate remains reviewable; do not pretend it passed.

The user must always be able to inspect why a result was blocked or warned.

## 11.5 Provider abstraction

Implement evaluator behind an adapter interface so tests can use deterministic fixtures and production can use an authorized multimodal model.

No paid evaluator call in tests. No fake “live success”.

If evaluator provider is not configured:

- structural checks still run;
- visual-evaluation capability reports unavailable;
- UI says visual check not run, not “consistent”.

---

# 12. Keyframe-first Animation Pipeline

The product should hide the technical two-stage workflow while preserving explicit cost/adoption decisions.

## 12.1 User-facing action

Primary action can be conceptually:

**Generate animation**

The system plans a staged pipeline when required by consistency needs and model capability.

## 12.2 Internal staged flow

```text
Shot Packet freeze
→ capability + consistency requirement analysis
→ keyframe generation using multi-reference edit model when needed
→ visual consistency evaluation
→ human Compare + Adopt keyframe
→ image-to-video using adopted keyframe as parent
→ temporal/physics evaluation on video
→ human Compare + Adopt animation
→ downstream audio/timeline/delivery lineage
```

## 12.3 Cost/approval behavior

Do not hide multiple paid calls.

Before execution, the plan must disclose:

- stages that may cost points
- chosen models
- capability downgrades
- whether keyframe generation is required or optional

Existing quota/approval/points/idempotency path remains authoritative.

No “one-click” behavior may bypass approvals by splitting work into hidden calls.

## 12.4 Reuse

If an acceptable adopted keyframe already exists and is not stale, reusing it for video should not regenerate it.

If only video motion is wrong, repair video without regenerating the image/keyframe when lineage and current state allow.

---

# 13. Targeted repair engine

Repair must be dimension-aware.

## 13.1 Examples

### Identity drift only

Keep:
- scene
- composition
- prop state

Strengthen:
- identity references / identity adapter
- previous frame only if trustworthy

### Style drift only

Keep:
- identity/Look refs
- composition

Strengthen:
- Style Canon refs / Style DNA / style adapter if available

### Prop detail mismatch

Keep:
- character identity and pose where possible

Strengthen:
- prop identity ref + state constraint

### Temporal hand swap

Use:
- previous adopted/end frame
- hand occupancy start state
- prop contact constraint

### Motion/physics issue only

Reuse adopted keyframe if valid; regenerate video stage only.

## 13.2 Repair planning contract

Repair planner must return:

- affected shots
- affected media stages
- reason
- references that will change
- projected paid operations
- which current assets remain untouched

No repair button may silently fan out to unrelated shots.

---

# 14. Animation Production Board / Review Queue

The deep engine should surface as a simple production workflow.

## 14.1 Shot lifecycle projection

Prefer deriving state from existing artifacts rather than creating a duplicate workflow table.

Possible derived lifecycle:

- storyboard
- needs_keyframe
- keyframe_review
- animation_generation
- animation_review
- audio
- continuity_review
- complete

Only persist new manual workflow facts that cannot be derived, e.g.:

- assignee
- explicit reviewer status
- optional due date / production note if product scope allows

## 14.2 Review Queue

The first screen should prioritize actionable problems:

- “3 shots need continuity review”
- “2 shots have style drift”
- “1 shot has prop ownership mismatch”
- “4 shots became stale after Look update”

Each item opens a focused comparison, not a giant technical dashboard.

## 14.3 Shot comparison view

For a problematic shot show:

- previous adopted shot frame
- current candidate/current frame
- next shot frame when available
- relevant Canon refs
- dimension findings
- repair action

Hide packet/fingerprint internals behind optional diagnostics.

## 14.4 Single primary CTA

Preserve the existing product principle: one visually primary next action. Do not create multiple competing “Fix / Regenerate / Adopt / Continue” primary buttons on the same surface.

Server projection should choose the next action from actual state.

---

# 15. Server-authoritative scorecard evolution

Extend the existing scorecard; do not create a parallel animation score system.

Current dimensions remain. Add or refine rows for:

- temporal visual continuity
- physics/motion
- output visual identity
- output visual style
- asset identity/state

A healthy project stays quiet.

Rows should say things like:

- `連戲・需確認：2 鏡左右手持物與上一鏡不一致`
- `畫風・需修復：3 鏡陰影方式偏離目前 Style Canon`
- `素材・阻擋：1 鏡藏寶圖外觀不是目前 Canon`
- `動作・需確認：1 鏡角色移動方向與上一鏡出口方向衝突`

Do not compress these into one average percentage.

---

# 16. Evaluation storage and idempotency

If durable evaluation evidence does not already have an appropriate table, add one additive table such as `generation_consistency_evaluations`.

Suggested properties:

- immutable evaluation row
- generation/asset/shot IDs
- exact evaluator version
- evidence fingerprint
- structured JSON result
- created timestamp
- provider/model metadata without secrets
- idempotency key = generation + evaluatorVersion + evidenceFingerprint

Re-running the same evaluation is idempotent.

If evidence changes (e.g. different Canon version or newly adopted previous frame), a new evaluation row may be produced; historical evidence remains inspectable.

No evaluation row becomes the Canon truth.

---

# 17. Security, rights and privacy

- Evaluator may only access assets visible to the project/team ACL.
- Do not leak cross-project private Canon refs into evaluator payloads.
- Reuse existing commercial-rights checks for external generation/training context.
- Evaluation itself must not broaden reuse rights.
- Do not persist signed private asset URLs longer than existing storage policy allows; store stable asset IDs / evidence fingerprints where possible.
- Never store provider secrets in evaluation trace.

---

# 18. Performance constraints

This work must preserve the large-storyboard scaling improvements already shipped.

Requirements:

- no per-shot N+1 workspace query cascade;
- board/review queue uses bounded batch reads;
- evaluator jobs are asynchronous/durable if they can exceed request duration;
- do not auto-evaluate hundreds of old assets on page load;
- evaluate on candidate completion, explicit recheck, or targeted stale event;
- video frame sampling is bounded and deterministic;
- project summary queries return compact findings, not raw evaluator payloads for every shot.

Target acceptance fixtures: 20 / 100 / 300-shot projects remain usable.

---

# 19. Implementation stack

Use stacked Draft PRs from the latest default. Do not make one giant runtime PR.

## PR-A — Temporal State + Sequence Lock foundation

Scope:

- baseline reconciliation
- extend expected/observed continuity contracts
- Sequence Lock projection/snapshot only where genuinely needed
- Asset Identity vs Asset State semantics
- targeted dependency/stale impact
- tests for script-authorized changes vs unintended breaks

No multimodal provider calls.

Definition of Done:

- expected start/end state can be computed for a multi-shot sequence
- prop holder/hand, position/direction and Look transitions are deterministic when known
- unknown stays unknown
- time jump/montage/scene transition semantics do not over-lock
- changing one Canon/Look/prop impacts only dependent shots

## PR-B — Motion/Physics + cross-shot frame propagation

Scope:

- ShotMotionContract
- structured motion/physics findings
- screen direction/axis semantics
- previous adopted frame / end-frame reference roles
- derived end-frame lineage
- capability-aware reference mixing

Definition of Done:

- previous frame can be attached only when model supports it
- dropped continuity references are reported honestly
- end-frame extraction has durable parent lineage
- hand swap / prop teleport / direction break fixtures produce expected findings

## PR-C — Style DNA + Multimodal Visual Judge

Scope:

- backward-compatible Style DNA descriptor
- evaluator adapter interface
- durable evaluation evidence
- structural + multimodal output dimensions
- evaluator-unavailable behavior
- scorecard integration

Definition of Done:

- deterministic fixture evaluator proves identity/look/prop/style/temporal/physics findings
- no provider configured = “not checked”, never false green
- old Style Canon payloads remain valid
- exact evidence/version trace is inspectable

## PR-D — Keyframe-first pipeline + targeted repair

Scope:

- staged generation plan
- keyframe → visual check → explicit Adopt → i2v → motion check → explicit Adopt
- cost/approval disclosure
- dimension-aware repair planner
- stage-level reuse

Definition of Done:

- valid adopted keyframe is reused
- motion-only repair does not regenerate image
- style-only/identity-only repair changes only required references/stage
- no hidden paid cascade
- existing Candidate/current invariants remain

## PR-E — Animation Production Board + browser/full-sequence acceptance

Scope:

- derived shot lifecycle
- review queue
- previous/current/next comparison UX
- single primary CTA
- mobile/desktop accessibility
- real PostgreSQL integration evidence
- 20/100/300-shot performance proof
- full sequence animation-consistency E2E

Definition of Done:

- animation team can operate without opening technical consistency settings
- every finding links to exact affected shots and evidence
- repair queue only regenerates selected/affected shots
- 390/430/768/1280/1440 browser evidence
- no desktop regression beyond intended animation workflow surfaces

---

# 20. Required acceptance scenario

Create a deterministic multi-shot story fixture containing at minimum:

1. Two recurring characters with stable identity.
2. Character A has Look 1, later an explicit script-authorized Look 2.
3. One recurring prop with distinctive identity details.
4. A prop handoff from A to B.
5. A wet/dry or damaged/intact state transition.
6. An established screen movement direction.
7. A shot with a deliberate axis reset.
8. A time jump that releases pose/position continuity but preserves identity.
9. A sequence Style Canon with palette/shading rules.
10. Keyframe → image-to-video lineage.

Inject deterministic bad candidates/fixtures that simulate:

- face/identity drift
- wrong Look
- prop missing defining detail
- prop wrong owner/hand
- unexplained left/right hand swap
- screen-direction flip
- style shading drift
- palette drift
- position jump
- a valid intentional costume change
- a valid time jump

Acceptance requires the system to separate intentional changes from true drift.

---

# 21. Machine-verifiable acceptance

Expand the animation consistency suite rather than replacing it.

Required proof groups:

## A. Input consistency

Existing #773/#774 assertions continue to pass:

- world/character/scene/prop anchors
- Look behavior
- fingerprints
- multi-reference capability honesty
- explicit Adopt

## B. Temporal state

- Shot N adopted end state becomes Shot N+1 expected start state
- prop handoff updates holder/hand only when resolved
- time jump releases only allowed constraints
- Look change is intentional when script-authorized

## C. Frame propagation

- supported edit/i2v model receives previous-frame reference role
- unsupported model reports capability downgrade
- stale/bad previous frame is not silently treated as trusted continuity truth

## D. Output evaluation

- injected identity drift → identity finding
- injected prop drift → prop finding
- injected style drift → style finding
- injected hand swap → temporal/physics finding
- intentional change fixture → no false blocker

## E. Repair

- only affected shot IDs selected
- motion-only repair stops at video stage
- keyframe reuse works
- explicit Adopt still required

## F. Performance

- no per-shot project summary fan-out
- 100/300 shot board query count remains bounded

---

# 22. Browser UX acceptance

At 390 / 430 / 768 / 1280 / 1440:

The animation team must be able to:

1. open a project;
2. see the next animation task;
3. open “needs review” shots;
4. compare previous/current/next visual context;
5. see human-readable findings by dimension;
6. choose repair or keep current;
7. see exactly which shots/stages will regenerate before paid execution;
8. compare Candidate vs current;
9. explicitly Adopt;
10. see the review queue shrink after repair.

No horizontal overflow, duplicate mobile/desktop controls, inaccessible icon-only actions, or hidden focus traps.

---

# 23. Non-goals / boundaries

Do not use this project to:

- redesign the entire ProjectPage;
- build a second Canon manager;
- build a second storyboard database;
- build a second generic task/project-management product;
- silently auto-fix all animation;
- claim pixel-perfect identity guarantees unsupported by provider capability;
- claim physically accurate simulation from a vision-language evaluator;
- train models automatically;
- auto-call paid providers in tests;
- merge the still-open unrelated CI PR #746 into this scope;
- refactor unrelated global navigation, mobile shell, rights or assistant systems.

---

# 24. Product language rules

Prefer:

- `一致`
- `需確認`
- `需修復`
- `前後不連貫`
- `畫風偏移`
- `素材外觀偏移`
- `動作可能不連續`
- `此模型無法使用上一鏡參考圖`

Avoid unsupported certainty such as:

- `100% 保證一致`
- `物理正確`
- `絕對同一張臉`
- `模型已鎖定` when the reference was not actually attached

---

# 25. Final Definition of Done

This master plan is complete only when the implementation stack proves all of the following:

1. The same characters remain identifiable across multi-shot generated outputs, not just prompts.
2. Script-authorized Look changes are accepted while accidental Look drift is flagged.
3. Recurring props keep stable identity while their story state can change.
4. Prop ownership/hand state propagates through explicit handoffs.
5. Previous shot visual state can guide the next shot when provider capability permits.
6. Unsupported reference propagation is visible as a capability downgrade.
7. Style Canon is evaluated across line/shading/palette/lighting/rendering dimensions.
8. Motion findings catch high-confidence continuity breaks without pretending to be full physics simulation.
9. Sequence-level continuity survives shot boundaries and intentionally resets only at authored breaks.
10. Candidate output is evaluated against the exact historical intent/evidence it used.
11. Evaluation cannot silently Adopt or overwrite Canon truth.
12. Repair targets only affected shots/media stages.
13. Keyframe-first animation can reuse good stages instead of regenerating everything.
14. Cost/approval remains explicit for multi-stage paid generation.
15. Animation Production Board/Review Queue is derived from existing truth and stays simple.
16. 20/100/300-shot projects do not reintroduce N+1 fan-out.
17. Existing #773/#774 animation consistency E2E remains green.
18. PostgreSQL, browser, accessibility and concurrency/idempotency evidence is recorded.
19. No second source of truth is introduced.
20. A human looking only at the resulting storyboard/rough cut can recognize a continuous world, continuous assets, continuous motion and one coherent visual style rather than a collection of independently sampled shots.

---

# 26. Execution instruction for the implementation agent

Use this document as the authoritative scope.

Before coding:

1. read PRs #752, #753, #756–#770, #773 and #774;
2. inspect latest default and reconcile what already exists;
3. keep #746 and unrelated work out of scope;
4. create PR-A through PR-E as stacked **Draft** implementation PRs;
5. do not stop at another plan;
6. do not fake provider success, training success or visual evaluation success;
7. do not auto-merge or force-push;
8. do not call paid providers without explicit authorization;
9. preserve explicit Candidate/Compare/Adopt and existing points/approval/idempotency semantics;
10. finish with actual PR numbers, tests, before/after query counts, browser evidence, and only genuine external blockers.
