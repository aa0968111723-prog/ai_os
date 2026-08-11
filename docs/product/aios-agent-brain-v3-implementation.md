# Aios Agent Brain v3 — implementation track

This branch/PR is the delivery track for upgrading Aios from a chat-oriented assistant into a goal-based, verified agent runtime.

## Product contract

The runtime must follow:

`UNDERSTAND → RESOLVE → MATCH → PLAN → AUTHORIZE → EXECUTE → VERIFY → CONTINUE → COMPLETE`

A response must never claim completion without verified evidence.

## Required implementation scope

1. **Typed GoalFrame + ActiveGoal**
   - semantic goal understanding, correction and continuation
   - bounded persisted continuation state
   - deterministic handling for replies such as `第二個`, `對`, `繼續`, `剛剛那些`

2. **Working Project Resolver**
   - explicit project mention > clarification answer > active goal > recent verified result > current page > unique candidate > clarification
   - server re-validates all IDs and ACL

3. **Source / Evidence Resolution**
   - distinguish Google Drive, Google Photos, local file/folder, URL, external AI/editor, project assets, Aios library
   - remote facts require remote evidence; never substitute project/library counts for remote counts

4. **Single Capability Registry**
   - one server-owned source of truth for read/write/handoff/browser/generation/editing/agent capabilities
   - include access, risk, execution mode, required slots, verification strategy and evidence scope

5. **Execution + Read-back Verification**
   - reuse existing core services rather than create duplicate data systems
   - HTTP/tool success is not enough; writes must read back expected state before `completed`
   - waiting, unsupported, pending picker, failed verification and tool failure must not render as completed

6. **Universal Intake as Agent handoff**
   - Drive/File/Folder/URL/external result workflows remain in the same active goal
   - verified imported IDs flow into recent action references for the next turn

7. **Computer / Browser honesty**
   - mock provider must never be represented as live external browsing
   - only server-confirmed real provider availability may execute browser actions

8. **Run continuity + transparent events**
   - closing the assistant panel or changing route must not stop the run
   - expose only verifiable execution events, never private chain-of-thought

9. **Transport / model correctness**
   - selected model/mode must reach SSE and fallback paths
   - no duplicate execution after partial SSE delivery
   - preserve one run identity across transport paths

10. **Mobile-first UX**
    - compact states: working / waiting / completed / failed / stopped
    - when waiting, clearly state what the user must do next

## Mandatory regression cases

- Drive import → picker → verified IDs → continuation
- ambiguous `雲端` → ask source instead of guessing
- Google Photos remote count unavailable → honest unsupported response
- `不是 Drive，是 Photos` corrects the same goal
- project candidates + `第二個` resolves candidate #2
- recent imported assets + `把這些整理一下`
- recent assets + `放第三鏡` → resolve shot → attach → read-back verify
- explicit named project overrides current page project
- unavailable browser provider never produces fake completion
- write success + read-back failure remains unverified/not completed
- close/reopen assistant panel preserves active run
- new explicit goal does not incorrectly continue an old goal
- partial SSE failure does not trigger duplicate tool execution
- selected model reaches backend

## Delivery rules

- Start from the current default branch state (which already includes the merged Agent/Computer Runtime work).
- Reuse existing ACL, audit, rate limit, billing/points, project state machine, storage, migrations and core services.
- Do not introduce duplicate Project/Asset/Storyboard/Database/Generation models.
- Temporary patch scripts/workflows from earlier Brain v2 experiments must not remain as production architecture if no longer needed.
- Do not disable or weaken tests to make CI pass.
- Do not merge the PR automatically.

## Definition of done

Implementation, relevant unit/integration regression tests, typecheck, build and self-review are complete; the branch is pushed and this PR is ready for review. Any external provider or credential dependency that remains unavailable must be documented explicitly as a real limitation rather than simulated success.
