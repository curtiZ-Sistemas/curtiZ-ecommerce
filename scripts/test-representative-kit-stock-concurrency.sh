#!/usr/bin/env bash
# This test only uses the temporary Supabase database created by this CI job.
set -euo pipefail
[[ "${GITHUB_ACTIONS:-}" == true ]] || { echo 'Requires an ephemeral CI database.' >&2; exit 1; }
db_psql() {
  docker exec -i -e PGPASSWORD=postgres supabase_db_curtiz-local \
    psql -X -w -U postgres -d postgres -v ON_ERROR_STOP=1 -qAt "$@"
}

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

db_psql <<'SQL'
create schema kit_concurrency_fixture;
create table kit_concurrency_fixture.ids as
select gen_random_uuid() actor,gen_random_uuid() application,gen_random_uuid() representative,
  gen_random_uuid() category,gen_random_uuid() product,gen_random_uuid() variant,gen_random_uuid() address,
  gen_random_uuid() rule_version,gen_random_uuid() request_key,null::uuid first_quote,null::uuid second_quote;
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
  select actor,'kit-race@example.invalid','{}','{}' from kit_concurrency_fixture.ids;
update public.profiles set status='active' where id=(select actor from kit_concurrency_fixture.ids);
insert into public.representative_applications(id,user_id) select application,actor from kit_concurrency_fixture.ids;
insert into public.representatives(id,user_id,application_id,status)
  select representative,actor,application,'approved_waiting_kit' from kit_concurrency_fixture.ids;
insert into public.categories(id,name,slug) select category,'Kit race fixture',category::text from kit_concurrency_fixture.ids;
insert into public.products(id,name,slug,category_id,status,base_price,weight_grams,width_cm,height_cm,length_cm)
  select product,'Synthetic kit',product::text,category,'draft',50,250,10,5,20 from kit_concurrency_fixture.ids;
insert into public.product_variants(id,product_id,sku,color_name,size)
  select variant,product,'RACE-'||variant,'White','37' from kit_concurrency_fixture.ids;
insert into public.product_images(product_id,storage_path,alt_text,width,height,is_primary)
  select product,'test/kit-race.webp','Synthetic fixture',720,720,true from kit_concurrency_fixture.ids;
update public.products set status='active' where id=(select product from kit_concurrency_fixture.ids);
insert into public.inventory(variant_id,available_quantity) select variant,3 from kit_concurrency_fixture.ids;
insert into private.bling_catalog_metadata(product_id,commercial_unit,pairs_per_sku,ncm,origin,cest,production_type,evidence_reference)
  select product,'UN',2,'64022000',0,'','T','Synthetic fixture evidence' from kit_concurrency_fixture.ids;
insert into private.bling_kit_fiscal_components(
  kit_variant_id,position,sku,description,unit,quantity_pairs,allocation_weight,ncm,origin,cest,source_hash,evidence_reference
)
  select f.variant,n,'RACE-PAIR-'||n,'Synthetic pair '||n,'PR',1,1,'64022000',0,'',
    private.bling_kit_source_hash(f.variant),'Synthetic fixture evidence'
  from kit_concurrency_fixture.ids f cross join generate_series(1,2) n;
insert into public.addresses(id,user_id,label,recipient_name,postal_code,street,number,district,city,state)
  select address,actor,'Synthetic','Synthetic recipient','30110-100','Test street','1','Test district','Test city','MG'
  from kit_concurrency_fixture.ids;
insert into private.representative_resale_fiscal_rule_versions
  (id,rule_key,version,issuer_reference,product_fingerprint,origin_state,destination_state,person_type,
    icms_status,final_consumer,purpose,valid_from,valid_until,fiscal_parameters)
select rule_version,gen_random_uuid(),1,'synthetic issuer',public.read_representative_resale_product_fingerprint(variant),
  'MG','MG','business','taxpayer',false,'resale',now()-interval '1 day',now()+interval '1 day',
  '{"buyerProfile":"MG02","issuerDocument":"12345678000195","classification":"third_party_no_st","creditEligible":false,
    "returnRules":{"own_inflow":{"cfop":"1202","taxCodeKind":"CSOSN","taxCode":"102","homologationEvidence":"synthetic return XML"}},
    "blingRule":{"scenario":"resale_in_state_no_credit","issuer_state":"MG","series":2,"document_model":55,"cfop":"5102",
    "csosn":"102","icms_rate":0,"pis_cst":"49","cofins_cst":"49","ipi_cst":"99","ipi_cenq":"999",
    "pis_rate":0,"cofins_rate":0,"ipi_rate":0,"natures":[{"final_consumer":false,"external_nature_id":123}]}}'
from kit_concurrency_fixture.ids;
insert into private.representative_resale_fiscal_rule_approvals(rule_version_id,approver_reference,evidence_reference)
  select rule_version,'synthetic approver','synthetic evidence' from kit_concurrency_fixture.ids;
insert into private.representative_kit_checkout_approvals(
  actor_id,rule_version_id,buyer_profile,buyer_fiscal_state,origin_postal_code,buyer_evidence,operation_evidence,
  stock_evidence,homologation_evidence,valid_until,buyer_document,buyer_legal_name,buyer_state_registration,buyer_fiscal_address)
select actor,rule_version,'MG02','MG','35520000','synthetic buyer','synthetic operation','synthetic stock',
  'synthetic XML authorization',now()+interval '1 hour','11222333000181','Synthetic buyer','0012345678900',
  '{"state":"MG","postal_code":"30110100","street":"Test street","number":"1","district":"Test district","city":"Test city"}'
from kit_concurrency_fixture.ids;
create function kit_concurrency_fixture.quote() returns uuid language sql as $$
  select (public.confirm_representative_kit_shipping_quote(actor,variant,2,address,'30110100',repeat('a',64),
    '1','PAC','Correios',2100,1800,4,'[]',now()+interval '20 minutes','35520000',5000,'[250,10,5,20]')->>'id')::uuid
  from kit_concurrency_fixture.ids;
$$;
update kit_concurrency_fixture.ids set first_quote=kit_concurrency_fixture.quote(),second_quote=kit_concurrency_fixture.quote();
SQL

db_psql >"$task_tmp/first.log" 2>"$task_tmp/first.err" <<'SQL' &
begin;
select public.reserve_representative_kit_order(actor,variant,2,first_quote,address,request_key,'35520000')->>'orderId'
  from kit_concurrency_fixture.ids;
select 'HOLD_OPEN';
select pg_sleep(5);
commit;
SQL
first_pid=$!
ready=false
for ((attempt=0; attempt<100; attempt++)); do
  if grep -q 'HOLD_OPEN' "$task_tmp/first.log"; then ready=true; break; fi
  sleep 0.05
done
if [[ "$ready" != true ]]; then cat "$task_tmp/first.err" >&2; exit 1; fi
db_psql <<'SQL'
do $$
declare f kit_concurrency_fixture.ids; started timestamptz:=clock_timestamp();
begin
  select * into strict f from kit_concurrency_fixture.ids;
  begin
    perform public.reserve_representative_kit_order(f.actor,f.variant,2,f.second_quote,f.address,gen_random_uuid(),'35520000');
    raise exception 'oversold_inventory';
  exception when check_violation then
    if sqlerrm <> 'kit_quote_unavailable' then raise; end if;
  end;
  if clock_timestamp()-started < interval '1 second' then raise exception 'stock_lock_wait_not_observed'; end if;
end $$;
SQL
wait "$first_pid"
first_pid=''
db_psql <<'SQL'
do $$
declare f kit_concurrency_fixture.ids; o private.representative_kit_orders;
begin
  select * into strict f from kit_concurrency_fixture.ids;
  select * into strict o from private.representative_kit_orders where actor_id=f.actor;
  if (public.reserve_representative_kit_order(f.actor,f.variant,2,f.first_quote,f.address,f.request_key,'35520000')->>'orderId')::uuid
    is distinct from o.id then raise exception 'incorrect_idempotent_replay'; end if;
  if not exists(select 1 from public.inventory where variant_id=f.variant and available_quantity=1 and reserved_quantity=2)
    or exists(select 1 from private.representative_kit_shipping_checkout_quotes where id=f.second_quote and used_at is not null)
    then raise exception 'unexpected_inventory_or_quote'; end if;
end $$;
SQL
echo 'Concurrent kit checkouts reserved stock once, preserved losing freight, and replayed the original order.'
