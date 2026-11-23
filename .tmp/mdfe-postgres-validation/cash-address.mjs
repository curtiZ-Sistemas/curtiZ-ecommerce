import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "./package/dist/index.js";
const db = new PGlite();
const migration = await readFile(new URL("../fiscal-kits-mg-20261119/supabase/migrations/20261120130000_representative_kit_address_delivery.sql",import.meta.url), "utf8");
const buyer = "10000000-0000-4000-8000-000000000001";
const selection = "10000000-0000-4000-8000-000000000002";
const address = "10000000-0000-4000-8000-000000000003";
const outside = "10000000-0000-4000-8000-000000000004";
const origin = "35524168";
await db.exec(String.raw`
create role anon; create role authenticated; create role service_role;
create schema private;
create table public.addresses(id uuid primary key,user_id uuid,state text,country text,postal_code text,
  updated_at timestamptz default now(),recipient_name text,street text,number text,complement text,district text,city text);
create table private.representative_kit_checkout_approvals(actor_id uuid,origin_postal_code text,revoked_at timestamptz,valid_until timestamptz);
create table private.representative_kit_collection_routes(id uuid,name text,origin_postal_code text,destination_from text,
  destination_through text,valid_until timestamptz,closed_at timestamptz,bling_method_ids jsonb,delivery_cents int,estimated_days int);
create table private.representative_kit_shipping_checkout_quotes(id uuid default gen_random_uuid() primary key,
  actor_id uuid,estimated_days int not null,service_id text not null,address_id uuid,address_updated_at timestamptz,
  origin_postal_code text,postal_code text,own_delivery_route_id uuid,collection_route_id uuid,
  amount_in_cents int,cost_in_cents int,service text);
create table private.representative_kit_orders(id uuid default gen_random_uuid() primary key,
  actor_id uuid,quote_id uuid,shipping_snapshot jsonb,collection_route_id uuid,own_delivery_route_id uuid);
create function public.read_representative_kit_grade_shipping(uuid,uuid,text,integer,uuid,text)
returns jsonb language sql as $$
  select jsonb_build_object('purchaseAvailable',exists(select 1 from private.representative_kit_checkout_approvals
    where actor_id=$1 and origin_postal_code=$6 and revoked_at is null),'priceCents',5500,'catalogHash','test');
$$;
create function public.confirm_representative_kit_grade_shipping(uuid,uuid,text,integer,uuid,text,text,timestamptz,text,text,text,text,integer,integer,integer,jsonb,timestamptz)
returns jsonb language sql as $$
  insert into private.representative_kit_shipping_checkout_quotes(actor_id,estimated_days,service_id,address_id,address_updated_at,
    origin_postal_code,postal_code,amount_in_cents,cost_in_cents,service)
  select $1,$15,$10,$5,$8,$6,replace(postal_code,'-',''),$13,$14,$11 from public.addresses where id=$5
  returning jsonb_build_object('id',id);
$$;
create function public.reserve_representative_kit_grade_order(uuid,uuid,text,integer,uuid,uuid,uuid,text)
returns jsonb language sql as $$
  insert into private.representative_kit_orders(actor_id,quote_id,shipping_snapshot)
  values ($1,$5,jsonb_build_object('originPostalCode',$8)) returning shipping_snapshot;
$$;
set check_function_bodies=false;
create schema auth;
create function auth.uid() returns uuid language sql as $$select current_setting('test.staff')::uuid$$;
create function private.has_permission(text) returns boolean language sql as $$select true$$;
create function private.current_app_role() returns text language sql as $$select 'operational'::text$$;
create table public.audit_logs(actor_id uuid,actor_role text,action text,entity_type text,entity_id uuid,new_data_sanitized jsonb);
alter table private.representative_kit_orders add column rule_version_id uuid, add column variant_id uuid, add column grade_kit_id uuid,
  add column grade_template text,add column quantity int,add column address_id uuid,add column idempotency_key uuid,
  add column state text default 'reserved',add column stock_state text default 'reserved',add column unit_price_cents bigint default 5500,
  add column shipping_cents bigint default 0,add column collection_method text,add column collection_bling_method bigint,
  add column collection_point_terminal text,add column cash_tendered_cents bigint,add column cancellation_requested_at timestamptz,
  add constraint representative_kit_order_collection_complete check(true);
alter table private.representative_kit_checkout_approvals add column rule_version_id uuid;
create table private.representative_kit_fulfillment(order_id uuid primary key,bling_sale_id bigint,bling_invoice_id bigint,shipment_rank int,checked_at timestamptz);
create table private.representative_kit_fulfillment_writes(order_id uuid,operation text,primary key(order_id,operation));
create table private.representative_resale_fiscal_rule_versions(id uuid primary key,fiscal_parameters jsonb);
create function private.representative_kit_commercial_configuration(uuid,uuid) returns boolean language sql as $$select true$$;
create function private.representative_kit_payment_allowed(private.representative_kit_orders) returns boolean language sql as $$select true$$;
create function private.representative_kit_order_summary(private.representative_kit_orders) returns jsonb language sql as $$
  select jsonb_build_object('orderId',$1.id,'state',$1.state,'snapshot',$1.shipping_snapshot)
$$;
create function public.claim_representative_kit_bling_write(uuid,text,text) returns boolean language plpgsql as $$
begin if not exists(select 1 from private.representative_kit_orders o where id=$1 and private.representative_kit_fiscal_ready(o)) then return false; end if;
insert into private.representative_kit_fulfillment_writes values($1,$2) on conflict do nothing; return found; end; $$;
create function private.reserve_representative_kit_grade_order(uuid,uuid,text,integer,uuid,uuid,uuid,text) returns jsonb language sql as $$
  insert into private.representative_kit_orders(actor_id,quote_id,grade_kit_id,grade_template,quantity,address_id,idempotency_key,rule_version_id,shipping_snapshot)
  select $1,$5,$2,$3,$4,$6,$7,rule_version_id,jsonb_build_object('originPostalCode',$8) from private.representative_kit_checkout_approvals
    where actor_id=$1 and origin_postal_code=$8 returning jsonb_build_object('orderId',id); $$;
`);
await db.exec(migration);
await db.exec("set check_function_bodies=true; create trigger kit_delivery before insert on private.representative_kit_orders for each row execute function private.record_representative_kit_own_delivery()");
await db.query("insert into public.addresses(id,user_id,state,country,postal_code,street) values ($1,$3,'MG','BR','30110-000','Rua de Teste'),($2,$3,'SP','BR','01000-000','Rua de Teste')",[address,outside,buyer]);
await db.query("insert into private.representative_kit_checkout_approvals values ($1,$2,null,'2099-01-01')",[buyer,origin]);
const quote = async (dest, from = null, atReceipt = false) => (await db.query(
  "select public.quote_representative_kit_own_delivery($1,$2,'standard',2,$3,$4,$5) as result",
  [buyer,selection,dest,from,atReceipt])).rows[0].result;
const prepaid = await quote(address);
assert.ok(prepaid.id);
assert.equal(prepaid.amountInCents,11000);
assert.equal(prepaid.shippingInCents,0);
assert.equal(prepaid.estimatedDays,null);
assert.deepEqual(prepaid.collectionMethods,[]);
assert.equal(await quote(outside),null);
assert.equal(await quote(address,"39999000"),null);
assert.equal(await quote(address,null,true),null);
const reserved = (await db.query("select public.reserve_representative_kit_own_delivery($1,$2,'standard',2,$3,$4,gen_random_uuid(),null) as result",
  [buyer,selection,prepaid.id,address])).rows[0].result;
assert.equal(reserved.deliveryAddress.street,"Rua de Teste");
assert.equal(reserved.deliveryAddress.postalCode,"30110000");
assert.equal(reserved.provider,"own_delivery");
assert.equal(reserved.routeId,null);
assert.equal(reserved.estimatedDays,null);
assert.equal((await db.query("select private.representative_kit_is_own_delivery(o) as result from private.representative_kit_orders o")).rows[0].result,true);
const cashMigration = await readFile(new URL("../fiscal-kits-mg-20261119/supabase/migrations/20261120133000_representative_kit_address_cash.sql",import.meta.url),"utf8");
await db.exec("set check_function_bodies=false");
await db.exec(cashMigration);
await db.exec("set check_function_bodies=true");
assert.equal(await quote(address,null,true),null);
const rule = "20000000-0000-4000-8000-000000000001";
const staff = "20000000-0000-4000-8000-000000000002";
const idem = "20000000-0000-4000-8000-000000000003";
const run = async (q,p=[]) => (await db.query(q,p)).rows[0].result;
await db.query("insert into private.representative_resale_fiscal_rule_versions values($1,$2)",[rule,JSON.stringify({cashAtDelivery:{blingPaymentMethodId:"11",homologationEvidence:"Synthetic XML evidence"}})]);
await db.query("update private.representative_kit_checkout_approvals set rule_version_id=$1",[rule]);
const cash = await quote(address,null,true);
assert.deepEqual(cash.collectionMethods,["cash"]);
assert.equal(cash.estimatedDays,null);
assert.equal(cash.amountInCents,11000);
assert.equal(await quote(outside,null,true),null);
const reserveCash = (method,tendered) => run("select public.reserve_representative_kit_own_collection($1,$2,\x27standard\x27,2,$3,$4,$5,null,$6,$7) as result",[buyer,selection,cash.id,address,idem,method,tendered]);
await assert.rejects(reserveCash("credit_card",12000),{code:"22023"});
await assert.rejects(reserveCash("cash",10999),{code:"23514"});
await assert.rejects(run("select public.reserve_representative_kit_own_delivery($1,$2,\x27standard\x27,2,$3,$4,$5,null) as result",[buyer,selection,cash.id,address,idem]), {code:"23514"});
const placed = await reserveCash("cash",12000);
assert.equal(placed.state,"awaiting_receipt");
assert.equal(placed.snapshot.routeId,null);
assert.equal((await reserveCash("cash",12000)).orderId,placed.orderId);
await assert.rejects(reserveCash("cash",13000),{code:"23505"});
const ready = () => run("select private.representative_kit_fiscal_ready(o) as result from private.representative_kit_orders o where id=$1",[placed.orderId]);
const schedule = day => run("select public.schedule_representative_kit_cash_delivery($1,$2) as result",[placed.orderId,day]);
const claim = day => run("select public.claim_representative_kit_bling_write_for_delivery($1,\x27bling_sale\x27,null,$2) as result",[placed.orderId,day]);
assert.equal(await ready(),false);
await db.query("select set_config(\x27test.staff\x27,$1,false)",[buyer]);
assert.equal(await schedule("2099-01-01"),false);
await db.query("select set_config(\x27test.staff\x27,$1,false)",[staff]);
assert.equal(await schedule("2000-01-01"),false);
assert.equal(await schedule("2099-01-01"),true);
assert.equal(await ready(),true);
assert.equal(await schedule("2099-01-02"),true);
assert.equal(await claim("2099-01-01"),false);
assert.equal(await claim("2099-01-02"),true);
assert.equal(await claim("2099-01-02"),false);
assert.equal(await schedule("2099-01-03"),false);
await db.close();
console.log("Address-only own delivery: PostgreSQL quote, rejection, reservation trigger and delivery classification passed.");

