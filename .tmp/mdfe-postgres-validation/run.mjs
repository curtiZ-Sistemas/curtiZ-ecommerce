import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "./package/dist/index.js";

const db = new PGlite();
const buyer = "10000000-0000-4000-8000-000000000001";
const staff = "20000000-0000-4000-8000-000000000002";
const route = "30000000-0000-4000-8000-000000000003";
const intermunicipal = "40000000-0000-4000-8000-000000000004";
const municipal = "50000000-0000-4000-8000-000000000005";
const incomplete = "60000000-0000-4000-8000-000000000006";
const legacy = "70000000-0000-4000-8000-000000000007";
const invoice = "31261112345678000195550030000000001123456789";
const key = "31261112345678000195580010000000011123456787";
const protocol = "100000000000006";
const evidence = "Conferência sintética na SEFAZ";

// Supporting schemas stand in for the app's existing tables and authorization.
// The migration, all of its functions, SQL constraints and dispatch writes are real.
await db.exec(`
  create role anon;
  create role authenticated;
  create role service_role;
  create schema private;
  create schema auth;
  create table auth.users(id uuid primary key);
  create function auth.uid() returns uuid language sql stable
    as $$select nullif(current_setting('request.test_staff',true),'')::uuid$$;
  create function private.has_permission(text) returns boolean language sql stable
    as $$select auth.uid()='${staff}'::uuid and $1='orders.update_operational_status'$$;
  create function private.current_app_role() returns text language sql as $$select 'operational'::text$$;
  create table public.audit_logs(actor_id uuid,actor_role text,action text,entity_type text,entity_id uuid,new_data_sanitized jsonb);
  create table private.representative_kit_orders(id uuid primary key,actor_id uuid,state text,stock_state text,
    shipping_snapshot jsonb,collection_route_id uuid,own_delivery_route_id uuid,cancellation_requested_at timestamptz,
    collection_method text,quantity integer,product_name text,created_at timestamptz default now());
  create table private.representative_kit_fulfillment(order_id uuid primary key,invoice_access_key text,
    invoice_confirmed_at timestamptz,invoice_cancellation_confirmed_at timestamptz,shipment_status text,
    shipment_rank integer,bling_invoice_id bigint,shipment_id text,tracking_code text,checked_at timestamptz);
  create table private.representative_kit_collection_payments(order_id uuid primary key,point_key uuid,point_order_id text,
    point_status text,confirmed_at timestamptz,opened_by uuid);
  create function private.representative_kit_order_summary(private.representative_kit_orders) returns jsonb language sql
    as $$select jsonb_build_object('orderId',$1.id)$$;
  create function private.representative_kit_fiscal_ready(private.representative_kit_orders) returns boolean language sql
    as $$select $1.state='paid' or $1.state='awaiting_receipt'$$;
  create function private.representative_kit_payment_allowed(private.representative_kit_orders) returns boolean language sql as $$select true$$;
`);

const migration = new URL("../fiscal-kits-mg-20261119/supabase/migrations/20261120001812_representative_kit_mdfe_dispatch.sql",import.meta.url);
await db.exec(await readFile(migration,"utf8"));
await db.query("insert into auth.users values ($1),($2)",[buyer,staff]);

const snapshot = (postcode, city) => ({ originPostalCode: "35524168", address: { postalCode: postcode },
  deliveryAddress: { postalCode: postcode, city, state: "MG" } });
for (const [id, shipping, ownRoute] of [
  [intermunicipal,snapshot("30110100","Nova Serrana"),route],
  [municipal,snapshot("35522001","Nova Serrana"),route],
  [incomplete,{},route],
  [legacy,snapshot("30110100","Belo Horizonte"),null]
]) {
  await db.query(`insert into private.representative_kit_orders(id,actor_id,state,stock_state,shipping_snapshot,own_delivery_route_id)
    values ($1,$2,'paid','sold',$3,$4)`,[id,buyer,JSON.stringify(shipping),ownRoute]);
  await db.query(`insert into private.representative_kit_fulfillment(order_id,invoice_access_key,invoice_confirmed_at,shipment_status,shipment_rank,shipment_id)
    values ($1,$2,now(),'ready',1,'probe-shipment')`,[id,invoice]);
}
const dispatch = id => db.query("select public.manage_representative_kit_collection($1,'dispatch',$2) as result",[id,evidence]);
const check = (id,keyValue=key) => db.query("select public.confirm_representative_kit_mdfe($1,$2,$3,$4) as result",[id,keyValue,protocol,evidence]);
const first = r => r.rows[0].result;
const verifyDenied = async id => assert.rejects(dispatch(id),error => error.code==="23514" && error.message==="kit_mdfe_required");
assert.equal(first(await db.query("select private.representative_kit_requires_mdfe($1) as result",
  [JSON.stringify(snapshot("35529000","Nova Serrana"))])),false);
await db.query("select set_config('request.test_staff',$1,false)",[buyer]);
await assert.rejects(check(intermunicipal),error=>error.code==="42501");
await db.query("select set_config('request.test_staff',$1,false)",[staff]);
assert.deepEqual(first(await dispatch(municipal)),{ok:true});
await verifyDenied(incomplete);
await verifyDenied(intermunicipal);
assert.equal(first(await check(intermunicipal,key.slice(0,-1)+"0")),false);
assert.equal(first(await check(intermunicipal)),true);
const queue = first(await db.query("select public.list_representative_kit_collection_work() as result"));
assert.equal(queue.find(row=>row.orderId===intermunicipal).mdfeVerified,true);
assert.deepEqual(first(await dispatch(intermunicipal)),{ok:true});
assert.equal(first(await check(intermunicipal)),false);
await db.query("select public.manage_representative_kit_collection($1,'delivery_failed',$2)",[intermunicipal,evidence]);
await verifyDenied(intermunicipal);
assert.equal(first(await check(intermunicipal)),false);

const tracking = id => db.query("select public.record_representative_kit_tracking($1,'probe-shipment',$2,'dispatched',null) as result",[id,invoice]);
assert.equal(first(await tracking(incomplete)),false);
assert.equal(first(await tracking(legacy)),true);
await db.exec("set role authenticated");
await assert.rejects(db.query("select * from private.representative_kit_mdfe_checks"),error=>error.code==="42501");
await db.exec("reset role");
assert.equal(first(await db.query(`select relforcerowsecurity as result from pg_class
  where oid='private.representative_kit_mdfe_checks'::regclass`)),true);

await db.exec(`
  alter table private.representative_kit_orders add column rule_version_id uuid,
    add column returned_kit_count integer not null default 0,add column unit_price_cents bigint,add column shipping_cents bigint,
    add column buyer_snapshot jsonb;
  alter table private.representative_kit_fulfillment add column invoice_xml_sha256 text;
  create table private.representative_resale_fiscal_rule_versions(id uuid primary key,fiscal_parameters jsonb);
  create table private.representative_kit_returns(id uuid primary key default gen_random_uuid(),order_id uuid not null,
    request_key uuid not null,quantity integer not null,reason text,state text,inspected_by uuid,
    inspection_reference text,restock_quantity integer,bling_invoice_id bigint unique,document_origin text,
    invoice_key text unique,refund_cents bigint,invoice_protocol text,invoice_sha256 text,checked_at timestamptz);
  create function private.require_permission(text) returns void language plpgsql as $$
    begin if auth.uid() is distinct from '${staff}'::uuid or $1<>'returns.inspect' then
      raise exception 'permission_denied' using errcode='42501'; end if; end;
  $$;
  create temp table stock_releases(order_id uuid,quantity integer);
  create function private.transfer_representative_kit_inventory(private.representative_kit_orders,integer,text,text,text,uuid,uuid)
    returns void language sql as $$insert into pg_temp.stock_releases values ($1.id,$2)$$;
`);
const returnsMigration = new URL("../fiscal-kits-mg-20261119/supabase/migrations/20261120003545_representative_kit_undelivered_return.sql",import.meta.url);
await db.exec(await readFile(returnsMigration,"utf8"));
const rule = "80000000-0000-4000-8000-000000000008";
const unpaid = "90000000-0000-4000-8000-000000000009";
const paid = intermunicipal;
await db.query("insert into private.representative_resale_fiscal_rule_versions values ($1,$2)",[rule,JSON.stringify({
  issuerDocument:"12345678000195",returnRules:{undelivered_return:{cfop:"1202",taxCodeKind:"CSOSN",taxCode:"102",homologationEvidence:"Synthetic authorized XML"}}
})]);
await db.query(`insert into private.representative_kit_orders(id,actor_id,state,stock_state,shipping_snapshot,collection_route_id)
  values ($1,$2,'awaiting_receipt','reserved',$3,$4)`,[unpaid,buyer,JSON.stringify(snapshot("30110100","Belo Horizonte")),route]);
await db.query(`insert into private.representative_kit_fulfillment(order_id,invoice_access_key,invoice_confirmed_at,shipment_status,shipment_rank)
  values ($1,$2,now(),'delayed',5)`,[unpaid,invoice]);
await db.query(`update private.representative_kit_orders set rule_version_id=$1,quantity=2,unit_price_cents=5000,shipping_cents=0 where id in ($2,$3)`,[rule,unpaid,paid]);
await db.query(`update private.representative_kit_fulfillment set invoice_xml_sha256=repeat('a',64),bling_invoice_id=200 where order_id in ($1,$2)`,[unpaid,paid]);
const inputKey = invoice.slice(0,22)+"004"+invoice.slice(25,-1)+"2";
const paidKey = inputKey.slice(0,-1)+"3";
const register = (id,erp,k,stock) => db.query(`select public.register_representative_kit_undelivered_return($1,$2,$3,$4,$5) as result`,[id,erp,k,stock,evidence]);
const verify = (id,key) => db.query(`select public.record_representative_kit_return_invoice($1,$2,$3,repeat('a',64)) as result`,[id,key,protocol]);
assert.equal(first(await register(unpaid,300,inputKey,1)),false);
assert.equal(first(await register(unpaid,300,inputKey,2)),true);
assert.equal(first(await register(unpaid,300,inputKey,2)),true);
assert.equal(first(await register(paid,301,paidKey,1)),true);
assert.equal(first(await dispatch(paid)),null);
const jobs = first(await db.query(`select public.due_representative_kit_return_invoices() as result`));
const unpaidJob = jobs.find(job=>job.invoiceId===300);
const paidJob = jobs.find(job=>job.invoiceId===301);
assert.equal(unpaidJob.fiscalTotalInCents,10000);
assert.equal(unpaidJob.returnRule.cfop,"1202");
assert.deepEqual((await db.query(`select * from pg_temp.stock_releases`)).rows,[]);
assert.equal(first(await verify(unpaidJob.returnId,paidKey)),false);
assert.equal(first(await verify(unpaidJob.returnId,inputKey)),true);
assert.equal(first(await verify(unpaidJob.returnId,inputKey)),true);
assert.equal(first(await verify(paidJob.returnId,paidKey)),true);
assert.deepEqual((await db.query(`select * from pg_temp.stock_releases`)).rows,[{order_id:unpaid,quantity:2}]);
assert.deepEqual((await db.query(`select state,refund_cents from private.representative_kit_returns order by bling_invoice_id`)).rows,
  [{state:"completed",refund_cents:null},{state:"verified",refund_cents:10000}]);
await db.close();
console.log("MDF-e PostgreSQL checks passed: local/unknown/intermunicipal, permissions, checksum, approval, failed delivery, legacy tracking, RLS.");
console.log("Undelivered return PostgreSQL checks passed: inspection, fiscal approval, unpaid stock release once, and paid return awaiting reconciliation.");
