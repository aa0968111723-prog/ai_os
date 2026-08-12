# Aios Agent Brain v3 — implementation track

This branch/PR upgrades Aios from a chat-oriented assistant into a goal-based, verified agent runtime.

## Product contract

`UNDERSTAND → RESOLVE → MATCH → PLAN → AUTHORIZE → EXECUTE → VERIFY → CONTINUE → COMPLETE`

A response must never claim completion without verified evidence.

## Required implementation scope

1. Typed GoalFrame and bounded ActiveGoal continuation.
2. Server-side working-project and entity resolution with ACL revalidation.
3. Strict source and evidence boundaries; remote facts require remote evidence.
4. One shared capability registry describing access, risk, execution, and verification.
5. Existing core-service execution followed by read-back verification for writes.
6. Universal Intake as a resumable Agent handoff with verified result references.
7. Honest Computer Runtime availability: mock providers never represent live browsing.
8. Route-safe run continuity and verifiable public execution events.
9. Single-identity SSE/model transport without duplicate fallback execution.
10. Compact mobile working, waiting, completed, failed, and stopped states.

## Mandatory regression cases

- Drive import → picker → verified IDs → continuation.
- Ambiguous cloud source asks rather than guessing.
- Unsupported Google Photos remote count never substitutes local counts.
- Source corrections and numbered project choices continue the same goal.
- Recent imported assets remain bounded typed references for organize/attach.
- Named projects override page context.
- Browser unavailability and read-back failure never produce completion.
- Closing/reopening the panel and route changes preserve the run.
- A new explicit goal does not continue stale state.
- Partial SSE delivery does not trigger duplicate execution.
- The selected model reaches the backend.

## Delivery rules

Reuse existing ACL, audit, billing, storage, project, asset, storyboard, database,
generation, intake, and Agent Runtime services. Temporary patch workflows are not
production architecture and must not remain. Tests may not be disabled or weakened.
