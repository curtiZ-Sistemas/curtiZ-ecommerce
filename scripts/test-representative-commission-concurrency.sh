#!/usr/bin/env bash
# Runs only against the ephemeral database created by the GitHub Actions job.
set -euo pipefail
[[ "${GITHUB_ACTIONS:-}" == true ]] || { echo 'This test requires the isolated GitHub Actions database.' >&2; exit 1; }
cd "$(dirname "$0")/.."
task_tmp="$(mktemp -d)"
trap 'rm -f "$task_tmp/first.log" "$task_tmp/first.err" "$task_tmp/second.log" "$task_tmp/second.err"; rmdir "$task_tmp"' EXIT
db_psql() {
  docker exec -i -e PGPASSWORD=postgres supabase_db_curtiz-local \
    psql -X -w -U postgres -d postgres -v ON_ERROR_STOP=1 -qAt "$@"
}

# Fixtures are committed only inside CI's disposable database, so independent
# sessions can observe them. The database is discarded at the end of the job.
{
  printf 'begin;\n'
  sed -n '/^insert into auth.users/,/^select throws_ok/{ /^select throws_ok/!p; }' supabase/tests/representative_portal_safety_test.sql
  printf 'commit;\n'
} | db_psql

run_race() {
  local operation="$1" expected="$2" first_pid ready=false
  {
    printf "begin; update public.commission_entries set status='paid' where id='f6000000-0000-4000-8000-000000000002';\n"
    printf "select 'COMMISSION_LOCKED'; select pg_sleep(3); commit;\n"
  } | db_psql >"$task_tmp/first.log" 2>"$task_tmp/first.err" &
  first_pid=$!
  for ((attempt=0; attempt<200; attempt++)); do
    if grep -q 'COMMISSION_LOCKED' "$task_tmp/first.log"; then ready=true; break; fi
    sleep 0.05
  done
  if [[ "$ready" != true ]]; then wait "$first_pid" || true; cat "$task_tmp/first.err" >&2; return 1; fi
  if ! db_psql >"$task_tmp/second.log" 2>"$task_tmp/second.err" <<SQL
do \$\$declare started timestamptz:=clock_timestamp(); begin
  begin
    $operation
    raise exception 'expected_commission_rejection';
  exception when check_violation then
    if sqlerrm <> '$expected' then raise; end if;
    if clock_timestamp()-started < interval '1 second' then raise exception 'concurrent_lock_wait_not_observed'; end if;
  end;
end;\$\$;
select 'BLOCKED_AND_REJECTED';
SQL
  then wait "$first_pid" || true; cat "$task_tmp/second.err" >&2; return 1; fi
  wait "$first_pid"
  grep -q 'BLOCKED_AND_REJECTED' "$task_tmp/second.log"
  db_psql -c "update public.commission_entries set status='payable' where id='f6000000-0000-4000-8000-000000000002'"
}

run_race "update public.representative_sales set status='cancelled' where id='f4000000-0000-4000-8000-000000000003';" 'sale has a settled or closed commission'
run_race "delete from public.commission_entries where id='f6000000-0000-4000-8000-000000000002';" 'sale commission is already paid'
db_psql <<'SQL'
do $$begin
  if not exists (select 1 from public.representative_sales where id='f4000000-0000-4000-8000-000000000003' and status='confirmed')
     or not exists (select 1 from public.commission_entries where id='f6000000-0000-4000-8000-000000000002' and status='payable') then
    raise exception 'commission_or_sale_changed';
  end if;
end;$$;
SQL
echo 'Representative commission: concurrent cancellation and deletion rejected after payment.'
