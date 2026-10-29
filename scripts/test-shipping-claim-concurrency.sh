#!/usr/bin/env bash
# The CI job owns this temporary Supabase container; never use a shared project.
set -euo pipefail
[[ "${GITHUB_ACTIONS:-}" == true ]] || { echo 'Requires an ephemeral CI database.' >&2; exit 1; }
task_tmp="$(mktemp -d)"
first_pid=''
cleanup() {
  local result=$?
  if [[ -n "$first_pid" ]]; then wait "$first_pid" || result=1; fi
  rm -f "$task_tmp/first.log" "$task_tmp/first.err"
  rmdir "$task_tmp"
  exit "$result"
}
trap cleanup EXIT
db_psql() {
  docker exec -i -e PGPASSWORD=postgres supabase_db_curtiz-local \
    psql -X -w -U postgres -d postgres -v ON_ERROR_STOP=1 -qAt "$@"
}
db_psql <<'SQL'
do $$ begin
  if exists(select 1 from public.background_jobs where queue='shipping' and status in ('pending','running')) then
    raise exception 'shipping_queue_not_empty';
  end if;
end $$;
insert into public.background_jobs(id,queue,job_type,payload_sanitized,idempotency_key)
values ('fe540000-0000-4000-8000-000000000001','shipping','melhorenvio.sync',
  '{"shipmentId":"fe540000-0000-4000-8000-000000000002","testFixture":true}',
  'test:shipping-race:fe540000');
SQL
db_psql >"$task_tmp/first.log" 2>"$task_tmp/first.err" <<'SQL' &
begin;
do $$ declare claimed jsonb; begin
  claimed:=public.claim_melhor_envio_fulfillment_job('fe540000-0000-4000-8000-000000000010',true,true);
  if claimed->>'id' is distinct from 'fe540000-0000-4000-8000-000000000001' then
    raise exception 'first_worker_did_not_claim_fixture';
  end if;
end $$;
select 'CLAIM_HELD';
select pg_sleep(5);
commit;
SQL
first_pid=$!
ready=false
for ((attempt=0; attempt<100; attempt++)); do
  if grep -q 'CLAIM_HELD' "$task_tmp/first.log"; then ready=true; break; fi
  sleep 0.05
done
if [[ "$ready" != true ]]; then cat "$task_tmp/first.err" >&2; exit 1; fi
db_psql <<'SQL'
begin;
do $$ declare started timestamptz:=clock_timestamp(); claimed jsonb; begin
  claimed:=public.claim_melhor_envio_fulfillment_job('fe540000-0000-4000-8000-000000000011',true,true);
  if claimed is not null then raise exception 'duplicate_shipping_claim'; end if;
  if clock_timestamp()-started<interval '1 second' then raise exception 'claim_lock_wait_not_observed'; end if;
end $$;
rollback;
SQL
wait "$first_pid"
first_pid=''
db_psql <<'SQL'
do $$ begin
  if not exists(select 1 from public.background_jobs where id='fe540000-0000-4000-8000-000000000001'
    and status='running' and attempts=1 and lock_id='fe540000-0000-4000-8000-000000000010') then
    raise exception 'fixture_claim_not_preserved';
  end if;
end $$;
SQL
echo 'Shipping: two concurrent workers cannot claim the same job.'

