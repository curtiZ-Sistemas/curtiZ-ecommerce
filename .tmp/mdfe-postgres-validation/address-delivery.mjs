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
await db.close();
console.log("Address-only own delivery: PostgreSQL quote, rejection, reservation trigger and delivery classification passed.");

