#!/usr/bin/env sh
# CI 專用：只可對 workflow 建立的拋棄式 PostgreSQL 執行。
# 覆蓋 dry-run 零寫入、空庫 migrate、冪等、並行、legacy adopt 與 ledger tamper fail-closed。
set -eu

expected_migrations="$(node -e "const j=require('./drizzle/meta/_journal.json'); process.stdout.write(String(j.entries.length))")"

reset_database() {
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q \
    -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS drizzle CASCADE;'
}

public_table_count() {
  psql "$DATABASE_URL" -tAc "select count(*) from pg_catalog.pg_tables where schemaname='public'"
}

ledger_count() {
  psql "$DATABASE_URL" -tAc "select count(*) from drizzle.__drizzle_migrations"
}

echo "[migration-ci] dry-run must not write"
reset_database
npm run db:migrate:dry-run
test "$(public_table_count)" = "0"
test "$(psql "$DATABASE_URL" -tAc "select to_regclass('drizzle.__drizzle_migrations') is null")" = "t"

echo "[migration-ci] reviewed legacy 0001 bridge records a prefix, then migrates forward"
reset_database
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f drizzle/0000_0000_baseline.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f drizzle/0001_managed_indexes.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c 'ALTER TABLE users ADD COLUMN unexpected_bridge_drift text;'
if npm run db:adopt:dry-run -- --through=0001_managed_indexes; then
  echo "legacy bridge unexpectedly accepted unrelated schema drift" >&2
  exit 1
fi
reset_database
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f drizzle/0000_0000_baseline.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f drizzle/0001_managed_indexes.sql
bridge_output="$(npm run db:adopt:dry-run -- --through=0001_managed_indexes)"
printf '%s\n' "$bridge_output"
bridge_confirmation="$(
  printf '%s\n' "$bridge_output" \
    | sed -n 's/.*--confirm=\([0-9a-f][0-9a-f]*\).*/\1/p' \
    | tail -n 1
)"
test -n "$bridge_confirmation"
npm run db:adopt -- --through=0001_managed_indexes "--confirm=$bridge_confirmation"
test "$(ledger_count)" = "2"
npm run db:migrate
npm run db:check
test "$(ledger_count)" = "$expected_migrations"

echo "[migration-ci] empty migrate + check + idempotent rerun"
reset_database
npm run db:migrate
npm run db:check
npm run db:migrate
test "$(ledger_count)" = "$expected_migrations"

echo "[migration-ci] legacy schema requires explicit fingerprint adoption"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c 'DROP SCHEMA drizzle CASCADE;'
adopt_output="$(npm run db:adopt:dry-run)"
printf '%s\n' "$adopt_output"
fingerprint="$(printf '%s\n' "$adopt_output" | sed -n 's/.*migration fingerprint: \([0-9a-f][0-9a-f]*\).*/\1/p' | head -n 1)"
test -n "$fingerprint"
npm run db:adopt -- "--confirm=$fingerprint"
npm run db:check
test "$(ledger_count)" = "$expected_migrations"

echo "[migration-ci] two migrators cannot create duplicate ledger rows"
reset_database
set +e
npm run db:migrate > /tmp/migrate-a.log 2>&1 &
pid_a=$!
npm run db:migrate > /tmp/migrate-b.log 2>&1 &
pid_b=$!
wait "$pid_a"
status_a=$?
wait "$pid_b"
status_b=$?
set -e
cat /tmp/migrate-a.log
cat /tmp/migrate-b.log
if [ "$status_a" -ne 0 ] && [ "$status_b" -ne 0 ]; then
  echo "both concurrent migrators failed" >&2
  exit 1
fi
npm run db:check
test "$(ledger_count)" = "$expected_migrations"

echo "[migration-ci] real PostgreSQL rollback/concurrency/expiry idempotency faults"
E2E_MOCK=1 RUN_PG_INTEGRATION=1 npx vitest run \
  server/services/databaseBatchIdempotency.pg.test.ts \
  server/services/agentSplitRecovery.pg.test.ts \
  server/services/agentEffectCore.pg.test.ts \
  server/services/taskWake.pg.test.ts

echo "[migration-ci] modified applied hash must fail closed"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q \
  -c "update drizzle.__drizzle_migrations set hash='tampered-by-ci' where id=(select min(id) from drizzle.__drizzle_migrations)"
if npm run db:check; then
  echo "db:check unexpectedly accepted a tampered migration hash" >&2
  exit 1
fi

echo "[migration-ci] all migration safety scenarios passed"
