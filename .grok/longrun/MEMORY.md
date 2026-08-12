# AIOS Long-run Memory — Agent ↔ Database

This is the durable memory for the 24-hour high-pressure loop.
Chat turns are observers. They are not the executor.

## Mission

Close the real loop:

USER → Agent understanding → context → tool → ACL → backend → **PostgreSQL** → effect → receipt → read-back → answer

Primary surface: **AI Agent + Database**. Other backends are supporting.

## Duration

- Soak wall-clock: **24 hours** (`SOAK_MINUTES=1440`)
- Engineering pulse: **every 60 seconds**
- No fake clocks. No sleep-only ticks.

## Must stay true

1. `DATABASE_URL_PRESENT` on the process that runs Agent/web/worker
2. App `pg.Pool` can `SELECT 1`
3. Web / Worker / Agent share the same `databaseIdentityHash`
4. Website `projects.list` count === Agent inventory `activeCount` (archived excluded)
5. Custom DB ≠ project assets
6. Write is not COMPLETED without receipt + read-back
7. Retry does not duplicate notes/tasks/bindings/billing
8. Watchdog never writes `status=done`

## Live files (not secrets)

| Path | Role |
|---|---|
| `.grok/longrun/MEMORY.md` | This contract |
| `.grok/longrun/state.json` | Last pulse / soak / findings (gitignored) |
| `/tmp/aios-db-soak-report.json` | Soak counters |
| `/tmp/aios-soak/` | PIDs and logs |

## Processes

- `scripts/agent-db-soak.ts` — 24h Agent-DB write/read-back pressure
- `scripts/agent-db-soak-loop.sh` — restart soak if it dies
- `scripts/aios-longrun-keepalive.sh` — restart Postgres + loop
- `scripts/aios-engineering-pulse.sh` — 60s audit + memory update

## Pulse checklist (every 60s)

1. Is local Postgres listening?
2. Is soak alive? If dead and `pass!=true`, restart
3. Probe `SELECT 1` via app Pool (no secret print)
4. Every 5th pulse: `backend:doctor` + Agent DB integrity
5. Append findings to `state.json.nextActions`
6. Never echo connection strings / passwords

## When a new chat turn starts

Read `MEMORY.md` then `state.json`. Continue from `nextActions`.
Do not start a second 24h soak if one is already running.
Push to `fix/aios-latest-defect-convergence` only. No new PR. No merge.
