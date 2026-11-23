import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "./package/dist/index.js";

const db = new PGlite();
const migration = name => readFile(new URL(`../fiscal-kits-mg-20261119/supabase/migrations/${name}.sql`,import.meta.url),"utf8");
const base = await migration("20261119153000_representative_kit_collection");
const constraint = await migration("20261119160000_representative_kit_collection_operations");
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema private; create schema auth;
  create function auth.uid() returns uuid language sql as $$select '10000000-0000-4000-8000-000000000001'::uuid$$;
  create function private.require_permission(text) returns void language sql as $$select$$;
  create function private.current_app_role() returns text language sql as $$select 'technical'::text$$;
  create table public.audit_logs(actor_id uuid,actor_role text,action text,entity_type text,entity_id uuid,new_data_sanitized jsonb);
  create table public.addresses(id uuid,user_id uuid,state text,country text,postal_code text,updated_at timestamptz);
  create table private.representative_kit_orders(id uuid,actor_id uuid,state text,unit_price_cents bigint,quantity integer,shipping_cents bigint,
    collection_route_id uuid,collection_method text,collection_bling_method bigint,collection_point_terminal text,cash_tendered_cents bigint,
    constraint representative_kit_order_collection_complete check (true));
`);
await db.exec(base.slice(0,base.indexOf("alter table private.representative_kit_shipping_checkout_quotes")));
await db.exec(constraint.slice(0,constraint.indexOf(";"))+";");
await db.exec(await migration("20261120004205_representative_kit_verified_payment_methods"));
const route = { name:"Synthetic route",origin_postal_code:"35524168",destination_from:"30110000",destination_through:"30110999",
  delivery_cents:0,estimated_days:2,verified_evidence:"Synthetic verification",valid_until:"2099-01-01T00:00:00Z" };
const create = async data => (await db.query("select public.manage_representative_kit_delivery_route(null,$1) as ok",
  [JSON.stringify(data)])).rows[0].ok;
assert.equal(await create({...route,bling_method_ids:{cash:"11"},point_terminal_id:"TEST_POINT"}),false);
assert.equal(await create({...route,bling_method_ids:{credit_card:"44"},point_terminal_id:null}),false);
assert.equal(await create({...route,bling_method_ids:{cash:"11"},point_terminal_id:null}),true);
assert.equal(await create({...route,destination_from:"30210000",destination_through:"30210999",bling_method_ids:{},point_terminal_id:null}),true);
assert.deepEqual((await db.query(`select bling_method_ids, point_terminal_id from private.representative_kit_collection_routes order by destination_from`)).rows,
  [{bling_method_ids:{cash:"11"},point_terminal_id:null},{bling_method_ids:{},point_terminal_id:null}]);
await db.close();
console.log("Payment method PostgreSQL checks passed: scoped route registration, cash-only and prepaid-only; electronic methods and terminals rejected.");
