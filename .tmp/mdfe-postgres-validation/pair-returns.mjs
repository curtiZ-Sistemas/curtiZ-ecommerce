import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "./package/dist/index.js";

const db = new PGlite();
const root = "../fiscal-kits-mg-20261119/supabase/migrations/";
const buyer = "10000000-0000-4000-8000-000000000001";
const staff = "10000000-0000-4000-8000-000000000002";
const order = "10000000-0000-4000-8000-000000000003";
const a = "10000000-0000-4000-8000-000000000004";
const b = "10000000-0000-4000-8000-000000000005";
const key = n => "3126111234567800019555004"+String(n).padStart(19,"0");
const saleKey = "3126111234567800019555003"+"1".repeat(19);
const grade = [{sku:"PAIR-A",variantId:a,pairs:2},{sku:"PAIR-B",variantId:b,pairs:1}];
const protocol = n => String(n).padStart(15,"0");
const hash = "a".repeat(64);
const read = name => readFile(new URL(root+name+".sql",import.meta.url),"utf8");
const run = async (query,params=[]) => (await db.query(query,params)).rows[0]?.value;
await db.exec(String.raw`
  create role anon; create role authenticated; create role service_role;
  create schema private; create schema auth;
  create function auth.uid() returns uuid language sql
    as $$select current_setting('request.test_staff')::uuid$$;
  create function private.require_permission(text) returns void language sql as $$select$$;
  create function private.current_app_role() returns text language sql as $$select 'operational'::text$$;
  create table public.profiles(id uuid primary key,status text);
  create table public.audit_logs(actor_id uuid,actor_role text,action text,entity_type text,entity_id uuid,new_data_sanitized jsonb);
  create table public.inventory(variant_id uuid primary key,available_quantity int,reserved_quantity int,version int default 0,updated_at timestamptz);
  create table public.inventory_movements(variant_id uuid,movement_type text,quantity int,previous_quantity int,new_quantity int,
    reason text,reference_type text,reference_id uuid,performed_by uuid);
  create table private.representative_kit_orders(id uuid primary key,actor_id uuid,state text,stock_state text,
    variant_id uuid,quantity int,unit_price_cents bigint,shipping_cents bigint,reserved_until timestamptz,
    collection_method text,cash_tendered_cents bigint,cash_change_cents bigint,
    grade_lines jsonb,returned_kit_count int default 0);
  create function private.representative_kit_is_own_delivery(private.representative_kit_orders) returns boolean language sql as $$select true$$;
  create table private.representative_kit_fulfillment(order_id uuid primary key,invoice_access_key text,
    invoice_protocol text,invoice_xml_sha256 text,invoice_cancellation_confirmed_at timestamptz,shipment_status text);
  create table private.representative_kit_returns(id uuid primary key default gen_random_uuid(),order_id uuid,
    request_key uuid,quantity int,reason text,state text default 'requested',instructions text,reviewed_by uuid,inspected_by uuid,
    inspection_reference text,restock_quantity int default 0,bling_invoice_id bigint,document_origin text,
    invoice_key text,invoice_protocol text unique,invoice_sha256 text,refund_cents bigint,checked_at timestamptz,
    created_at timestamptz default now(),return_kind text default 'delivered',pickup_on date,picked_up_at timestamptz,picked_up_by uuid,
    pickup_reference text,refund_prepared_by uuid,refund_confirmed_by uuid, unique(order_id,request_key));
  create table private.representative_kit_refund_requests(order_id uuid,kit_return_id uuid,reason text,
    started_at timestamptz,amount_cents bigint,return_invoice_key text,provider_refund_id text);
  set check_function_bodies=false;
`);
const original = await read("20261118173000_representative_kit_returns");
await db.exec(/create function public\.manage_representative_kit_return\([\s\S]*?\n\$\$;/.exec(original)[0].replace("function public.","function private."));
const inventory = await read("20261119143000_representative_kit_grade_inventory");
await db.exec(inventory.slice(0,inventory.indexOf("revoke all")));
await db.exec(await read("20261120131500_representative_kit_pair_returns"));
await db.exec("set check_function_bodies=true; create trigger refund_gate before update on private.representative_kit_refund_requests for each row execute function private.finalize_representative_kit_return(); create trigger refund_stock after update on private.representative_kit_refund_requests for each row execute function private.finalize_representative_kit_return()");
await db.query("select set_config('request.test_staff',$1,false)",[staff]);
await db.query("insert into public.profiles values($1,'active'),($2,'active')",[buyer,staff]);
await db.query("insert into public.inventory(variant_id,available_quantity,reserved_quantity) values($1,0,0),($2,0,0)",[a,b]);
await db.query("insert into private.representative_kit_orders(id,actor_id,variant_id,state,stock_state,quantity,unit_price_cents,shipping_cents,grade_lines) values($1,$2,$3,'paid','sold',2,3000,0,$4)",[order,buyer,a,JSON.stringify(grade)]);
await db.query("insert into private.representative_kit_fulfillment(order_id,invoice_access_key,invoice_protocol,invoice_xml_sha256,shipment_status) values($1,$2,$3,$4,'delivered')",[order,saleKey,protocol(9),hash]);
const request = (pairs,idem) => run("select public.request_representative_kit_pair_return($1,$2,$3,'Synthetic inspection',coalesce($4,gen_random_uuid())) as value",
  [buyer,order,JSON.stringify(pairs),idem ?? null]);
const manage = (id,action,details) => run("select public.manage_representative_kit_return($1,$2,$3) as value",[id,action,JSON.stringify(details)]);
const checkInvoice = (id,n,lines) => run("select public.record_representative_kit_return_invoice_lines($1,$2,$3,$4,$5) as value",
 [id,key(n),protocol(n),hash,JSON.stringify(lines)]);
const evidence = (sku,signature,quantity,saleQuantity) => ({sku,signature,quantity,saleQuantity});
const receive = async (id,n,restockPairs) => manage(id,"receive", {invoiceId:n,documentOrigin:"own_inflow",invoiceKey:key(n),
  refundInCents:1000,inspectionReference:"Synthetic inspection",restockQuantity:0,restockPairs});
const approveAndPickUp = async id => {
  const approved = await manage(id,"approve",{instructions:"Synthetic approval"});
  assert.equal(approved.state,"approved");
  await manage(id,"schedule_pickup",{pickupDate:"2099-01-01"});
  await manage(id,"confirm_pickup",{pickupReference:"Synthetic pickup"});
};
const idem = "10000000-0000-4000-8000-000000000006";
const first = await request({"PAIR-A":2},idem);
assert.deepEqual(first.requestedPairs,{"PAIR-A":2});
assert.equal((await request({"PAIR-A":2},idem)).id,first.id);
await assert.rejects(request({"PAIR-A":1},idem),{code:"23505"});
await assert.rejects(request({"PAIR-MISSING":1}),{code:"23514"});
await assert.rejects(request({"PAIR-A":3}),{code:"23514"});
const second = await request({"PAIR-A":1});
await assert.rejects(run("select public.request_representative_kit_return($1,$2,1,'Synthetic entry',gen_random_uuid()) as value",[buyer,order]),{code:"23514"});
await approveAndPickUp(first.id);
assert.equal(await receive(first.id,1,{"PAIR-B":1}),null);
assert.equal((await receive(first.id,1,{"PAIR-A":1})).state,"received");
assert.equal(await run("select public.record_representative_kit_return_invoice($1,$2,$3,$4) as value",[first.id,key(1),protocol(1),hash]),false);
const high = evidence("PAIR-A","high",1,1), low = evidence("PAIR-A","low",1,3);
assert.equal(await checkInvoice(first.id,1,[high,low]),true);
assert.equal(await checkInvoice(first.id,1,[high,low]),true);
await approveAndPickUp(second.id);
assert.equal((await receive(second.id,2,{})).state,"received");
assert.equal(await checkInvoice(second.id,2,[high]),false);
assert.equal(await checkInvoice(second.id,2,[low]),true);
assert.equal(await run("select available_quantity as value from public.inventory where variant_id=$1",[a]),0);
await db.query("update private.representative_kit_returns set state='refund_pending' where id=$1",[first.id]);
await db.query("insert into private.representative_kit_refund_requests(order_id,kit_return_id,reason,amount_cents,return_invoice_key) values($1,$2,'accepted_return',1000,$3)",[order,first.id,key(1)]);
await db.query("update private.representative_kit_refund_requests set started_at=now() where kit_return_id=$1",[first.id]);
await db.query("update private.representative_kit_refund_requests set provider_refund_id='fake-provider' where kit_return_id=$1",[first.id]);
await db.query("update private.representative_kit_refund_requests set provider_refund_id='fake-provider' where kit_return_id=$1",[first.id]);
assert.equal(await run("select available_quantity as value from public.inventory where variant_id=$1",[a]),1);
assert.equal(await run("select available_quantity as value from public.inventory where variant_id=$1",[b]),0);
assert.equal(await run("select count(*)::int as value from public.inventory_movements where reference_id=$1",[first.id]),1);
assert.equal(await run("select state as value from private.representative_kit_returns where id=$1",[first.id]),"completed");
assert.equal(await run("select has_function_privilege('authenticated','public.record_representative_kit_return_invoice_lines(uuid,text,text,text,jsonb)','execute') as value"),false);
await db.close();
console.log("Pair returns: PostgreSQL selection, SKU limits, inspection, fiscal line caps, idempotent inventory and permissions passed.");

