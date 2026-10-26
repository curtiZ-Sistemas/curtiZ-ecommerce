#!/usr/bin/env bash
# Runs only against the ephemeral Supabase container created by this CI job.
set -euo pipefail
[[ "${GITHUB_ACTIONS:-}" == true ]] || { echo 'This test requires the isolated GitHub Actions database.' >&2; exit 1; }
cd "$(dirname "$0")/.."
task_tmp="$(mktemp -d)"
fixture_created=false
task_main_pid="$BASHPID"
db_psql() {
  docker exec -i -e PGPASSWORD=postgres supabase_db_curtiz-local \
    psql -X -w -U postgres -d postgres -v ON_ERROR_STOP=1 -qAt "$@"
}
cleanup() {
  local result=$?
  [[ "$BASHPID" == "$task_main_pid" ]] || return 0
  if [[ "$fixture_created" == true ]]; then
    db_psql <<'SQL' || result=1
begin;
do $$begin
 if not exists(select 1 from auth.users where id='bd000000-0000-4000-8000-000000000001' and email='return-balance-concurrency-test@example.invalid')
 or not exists(select 1 from public.products where id='bd200000-0000-4000-8000-000000000001' and slug='return-balance-concurrency-test') then raise exception 'fixture_ownership_not_verified'; end if;
 if exists(select 1 from public.inventory where variant_id='bd300000-0000-4000-8000-000000000001'
  and (available_quantity<>0 or reserved_quantity<>0 or damaged_quantity<>0)) then raise exception 'fixture_stock_changed'; end if;
end;$$;
delete from public.return_items where return_id in(select id from public.returns where order_id='bd400000-0000-4000-8000-000000000001');
delete from public.returns where order_id='bd400000-0000-4000-8000-000000000001';
delete from public.order_items where order_id='bd400000-0000-4000-8000-000000000001';
delete from public.orders where id='bd400000-0000-4000-8000-000000000001';
delete from public.inventory where variant_id='bd300000-0000-4000-8000-000000000001';
delete from public.product_variants where id='bd300000-0000-4000-8000-000000000001';
delete from public.products where id='bd200000-0000-4000-8000-000000000001';
delete from public.categories where id='bd100000-0000-4000-8000-000000000001';
delete from auth.users where id in('bd000000-0000-4000-8000-000000000001','bd000000-0000-4000-8000-000000000002');
commit;
SQL
  fi
  rm -f "$task_tmp/first.log" "$task_tmp/first.err" "$task_tmp/second.log" "$task_tmp/second.err"
  rmdir "$task_tmp"
  exit "$result"
}
trap cleanup EXIT
{
  cat <<'SQL'
begin;
do $$begin if exists(select 1 from public.orders where id='bd400000-0000-4000-8000-000000000001') then raise exception 'test_fixture_already_exists'; end if; end;$$;
SQL
  sed -n '/^-- BEGIN RETURN BALANCE FIXTURE$/,/^-- END RETURN BALANCE FIXTURE$/p' supabase/tests/bling_return_archive_context_test.sql |
    sed -e 's/bb/bd/g' -e 's/return-archive-test/return-balance-concurrency-test/g' \
      -e 's/return-archive-other/return-balance-concurrency-other/g' \
      -e "s/20,10,2,12,'{}'/30,10,2,22,'{}'/" -e "s/'Test','37',2,10,20/'Test','37',3,10,30/"
  cat <<'SQL'
insert into public.returns(id,order_id,customer_id,reason,description,requested_resolution,eligibility_snapshot,status)
values('bd600000-0000-4000-8000-000000000004','bd400000-0000-4000-8000-000000000001','bd000000-0000-4000-8000-000000000001','Fixture','Synthetic concurrency fixture','refund','{}','rejected');
insert into public.return_items(id,return_id,order_item_id,quantity)
values('bd700000-0000-4000-8000-000000000004','bd600000-0000-4000-8000-000000000004','bd500000-0000-4000-8000-000000000001',1);
commit;
SQL
} | db_psql
fixture_created=true

run_race() {
  local first_sql="$1" second_sql="$2" first_pid ready=false
  { printf 'begin;\n%s\n' "$first_sql"; printf "select 'CURTIZ_RETURN_LOCKED'; select pg_sleep(3); commit;\n"; } |
    db_psql >"$task_tmp/first.log" 2>"$task_tmp/first.err" &
  first_pid=$!
  for ((attempt=0; attempt<200; attempt++)); do
    if grep -q 'CURTIZ_RETURN_LOCKED' "$task_tmp/first.log"; then ready=true; break; fi
    sleep 0.05
  done
  if [[ "$ready" != true ]]; then wait "$first_pid" || true; cat "$task_tmp/first.err" >&2; return 1; fi
  # A distinct psql process must block on A's real transaction, then reject.
  if ! db_psql >"$task_tmp/second.log" 2>"$task_tmp/second.err" <<SQL
do \$\$declare started timestamptz:=clock_timestamp();begin
 begin
  $second_sql
  raise exception 'expected_cumulative_rejection';
 exception when check_violation then
  if sqlerrm<>'return_cumulative_quantity_exceeded' then raise; end if;
  if clock_timestamp()-started<interval '1 second' then raise exception 'concurrent_lock_wait_not_observed'; end if;
 end;
end;\$\$;
select 'BLOCKED_AND_REJECTED';
SQL
  then wait "$first_pid" || true; cat "$task_tmp/second.err" >&2; return 1; fi
  wait "$first_pid"
  grep -q 'BLOCKED_AND_REJECTED' "$task_tmp/second.log"
}

run_race \
  "update public.returns set status='approved' where id='bd600000-0000-4000-8000-000000000003';" \
  "update public.returns set status='approved' where id='bd600000-0000-4000-8000-000000000004';"
db_psql -c "update public.returns set status='rejected' where id='bd600000-0000-4000-8000-000000000003';"
run_race \
  "update public.return_items set quantity=2 where id='bd700000-0000-4000-8000-000000000003';" \
  "update public.returns set status='approved' where id='bd600000-0000-4000-8000-000000000003';"
echo 'Return balance: concurrent reservations and quantity/reactivation race passed.'
