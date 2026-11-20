#!/usr/bin/env bash
set -euo pipefail
: "${RMT_PG18_BIN:?Use the existing signed PostgreSQL18.6 preparation helper}"
: "${RUNNER_TEMP:?A fresh CI temporary directory is required}"
task092_pg_home="$(mktemp -d "$RUNNER_TEMP/rmt-task092-pg.XXXXXX")"
task092_pg_data="$task092_pg_home/cluster"
task092_pg_port="$(env -u LD_LIBRARY_PATH node -e 'const s=require("node:net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')"
"$RMT_PG18_BIN/initdb" -D "$task092_pg_data" -U rmt092_synthetic --auth=trust --no-locale --encoding=UTF8
"$RMT_PG18_BIN/pg_ctl" -D "$task092_pg_data" -l "$task092_pg_home/postgres.log" -o "-h 127.0.0.1 -p $task092_pg_port -k $task092_pg_home" -w start
trap '"$RMT_PG18_BIN/pg_ctl" -D "$task092_pg_data" -m fast -w stop' EXIT
for suite in birth activity creation http; do
  task092_database="rmt_curve_production_smoke_task092_$suite"
  "$RMT_PG18_BIN/createdb" -h 127.0.0.1 -p "$task092_pg_port" -U rmt092_synthetic "$task092_database"
  case "$suite" in
    birth) task092_command=(pnpm --filter indexer exec tsx src/curve-production-birth-postgres-smoke.ts);;
    activity) task092_command=(pnpm --filter indexer exec tsx src/curve-production-activity-postgres-smoke.ts);;
    creation) task092_command=(pnpm --filter indexer test:curve-production);;
    http) task092_command=(pnpm --filter indexer test:worker-http);;
  esac
  env -u LD_LIBRARY_PATH DATABASE_URL="postgresql://rmt092_synthetic@127.0.0.1:$task092_pg_port/$task092_database" \
    "${task092_command[@]}" 2>&1 | tee "$RUNNER_TEMP/task092-$suite.log"
done
