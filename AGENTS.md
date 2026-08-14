# AGENTS.md

## Cursor Cloud specific instructions

AI Director OS (Aios) is a single full-stack app: one Express + tRPC + Drizzle server
(`server/`) that also serves realtime/WS, an MCP endpoint, and the built React client
(`client/`). In dev, Vite runs the client separately. PostgreSQL is the only hard
dependency. See `README.md` (本機開發) and `package.json` scripts for standard commands.

### Startup (the VM boot layer runs `npm install` automatically)

1. PostgreSQL 16 is installed in the snapshot but is not auto-started on boot. Start it:
   `sudo pg_ctlcluster 16 main start`. The `aidirector` database (role `postgres`,
   password `postgres`) and all applied migrations already live in the snapshot.
2. A gitignored `.env` (already present in the snapshot) provides `DATABASE_URL` and
   local dev secrets. The server auto-loads `.env` via `server/bootstrap/loadEnv.ts`
   (it only fills *missing* keys), and Vite reads `VITE_*` from it — so you do NOT need
   to `source` it. If `.env` is ever missing, recreate it with at least:
   `DATABASE_URL=postgres://postgres:postgres@localhost:5432/aidirector`,
   `VITE_POSTHOG_KEY=phc_local_dev_placeholder`,
   `VITE_POSTHOG_HOST=https://us.i.posthog.com`,
   `SEED_ADMIN_EMAIL=admin@aidirector.local`,
   `SEED_ADMIN_PASSWORD=dev-admin-123456`, plus 32+ char `RATE_LIMIT_SECRET` and
   `ASSET_SIGN_SECRET`.
3. Run the app: `npm run dev` (server on :3000, Vite client on :5173). Open
   http://localhost:5173 . First boot seeds teams/groups and the dev admin account.
   Log in with `admin@aidirector.local` / `dev-admin-123456`.

### Non-obvious gotchas

- `VITE_POSTHOG_KEY` / `VITE_POSTHOG_HOST` are REQUIRED even locally: `client/src/posthog.ts`
  intentionally throws in dev when they are unset (the app renders a blank "載入中…"
  screen). Placeholder values are fine; keep them in `.env`. Do not "fix" this in code.
- Do NOT put `APP_URL` (or `PUBLIC_DOMAIN`) in `.env`. The Vitest suite auto-loads `.env`,
  and `server/services/storage.persist.test.ts` asserts the `PUBLIC_DOMAIN` fallback with
  `APP_URL` unset — an `APP_URL` in `.env` makes that one test fail. `APP_URL` is optional
  for local dev anyway.
- Without `FAL_KEY`, `/api/ready` returns `ok:false` with only the `fal`/`provider`
  component unhealthy — this is EXPECTED. All core flows (auth, projects, worldview,
  storyboard, teams, DB) work; only real media generation fails (and refunds points).
- `undici` prints an EBADENGINE warning on Node 22.14 (it wants ≥22.19). It is only a
  warning; install and runtime work fine.
- DB migrations are version-gated: the server refuses to start on schema drift. If you
  change the schema, use `npm run db:migrate` / `npm run db:check` (drizzle-kit).

### Lint / test / build (mirrors `.github/workflows/ci.yml`)

- Lint gates: `npm run typecheck`, `npm run check:ui-primitives`,
  `npm run check:boundaries`, `npm run check:hooks`.
- Tests: `npm test` (server Vitest, ~2900 tests) and `npm run test:client` (client Vitest).
- Build: `npm run build`. Python e2e suites: `bash scripts/run-e2e-local.sh` (uses
  `E2E_MOCK=1`; needs a reset DB per suite).
