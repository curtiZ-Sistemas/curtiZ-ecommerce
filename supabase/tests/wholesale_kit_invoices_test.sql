begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- One accountant with the new permission, one user without it, one kit with its own sheet stock.
create temporary table wholesale_fixture as
select gen_random_uuid() accountant, gen_random_uuid() outsider, gen_random_uuid() category, gen_random_uuid() product,
  gen_random_uuid() kit, gen_random_uuid() rule_version, gen_random_uuid() request_key, gen_random_uuid() other_key,
  null::uuid invoice;
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
  select accountant,'wholesale-accountant@example.invalid','{}'::jsonb,'{}'::jsonb from wholesale_fixture
  union all select outsider,'wholesale-outsider@example.invalid','{}'::jsonb,'{}'::jsonb from wholesale_fixture;
update public.profiles set status='active' where id in (select accountant from wholesale_fixture union select outsider from wholesale_fixture);
insert into public.user_permission_overrides(user_id,permission_id,allowed,reason,created_by)
  select f.accountant,p.id,true,'Synthetic wholesale accountant',f.outsider
  from public.permissions p cross join wholesale_fixture f where p.code='fiscal.wholesale_invoices.issue';

insert into public.categories(id,name,slug) select category,'Wholesale test',category::text from wholesale_fixture;
insert into public.products(id,name,slug,category_id,status,base_price,weight_grams,width_cm,height_cm,length_cm)
  select product,'Wholesale grade fixture',product::text,category,'draft',35,150,8,4,16 from wholesale_fixture;
insert into public.product_variants(product_id,sku,color_name,size)
  select product,'TEST-WHOLESALE-'||s,'White',s::text from wholesale_fixture cross join generate_series(34,39) s;
insert into public.product_images(product_id,storage_path,alt_text,width,height,is_primary)
  select product,'test/wholesale.webp','Wholesale fixture',720,720,true from wholesale_fixture;
update public.products set status='active' where id=(select product from wholesale_fixture);
insert into public.inventory(variant_id,available_quantity,reserved_quantity)
  select v.id,5,0 from public.product_variants v join wholesale_fixture f on v.product_id=f.product;
insert into private.bling_catalog_metadata(product_id,commercial_unit,pairs_per_sku,ncm,origin,cest,production_type,evidence_reference)
  select product,'PR',1,'64022000',0,'','T','Wholesale synthetic evidence' from wholesale_fixture;
insert into public.kits(id,name,slug,description,price_in_cents,grade_product_id,grade_color,created_by,
  grade_standard_price_cents,grade_lower_restock_price_cents,grade_upper_restock_price_cents,
  grade_standard_stock,grade_lower_restock_stock,grade_upper_restock_stock)
  select kit,'Wholesale test kit',kit::text,'Wholesale fixture',36001,product,'White',outsider,36001,35001,37001,5,0,0
  from wholesale_fixture;

create function pg_temp.buyer(p_document text default '11222333000181', p_state text default 'MG', p_registration text default '')
returns jsonb language sql as $$
  select jsonb_build_object('document',p_document,'name','Loja Teste LTDA','registration',p_registration,
    'address',jsonb_build_object('state',p_state,'postal_code','30110100','street','Rua Teste','number','10',
      'district','Centro','city','Belo Horizonte'));
$$;
create function pg_temp.create_invoice(p_key uuid, p_quantity integer default 2, p_price integer default 36001, p_buyer jsonb default null)
returns jsonb language sql as $$
  select public.create_wholesale_kit_invoice(p_key,kit,'standard',p_quantity,p_price,'pix',coalesce(p_buyer,pg_temp.buyer()))
  from wholesale_fixture;
$$;
create function pg_temp.standard_stock() returns integer language sql as $$
  select grade_standard_stock from public.kits where id=(select kit from wholesale_fixture);
$$;

select ok(not has_table_privilege('authenticated','private.wholesale_kit_invoices','select'),
  'wholesale invoices are never readable directly');
select ok(not has_table_privilege('service_role','private.wholesale_kit_invoice_writes','insert'),
  'the service API cannot write the Bling claims directly');
select ok(not has_function_privilege('anon','public.create_wholesale_kit_invoice(uuid,uuid,text,integer,integer,text,jsonb)','execute'),
  'anonymous callers cannot create wholesale invoices');
select ok(not has_function_privilege('authenticated','public.begin_wholesale_kit_invoice_issue(uuid)','execute'),
  'signed-in clients cannot run the worker side');
select ok(has_function_privilege('service_role','public.begin_wholesale_kit_invoice_issue(uuid)','execute'),
  'the worker can start an issue');
select ok((select count(*)=2 from public.role_permissions rp join public.permissions p on p.id=rp.permission_id
  where p.code='fiscal.wholesale_invoices.issue' and rp.role in ('manager','admin')),
  'manager and admin receive the permission');

-- A user without the permission is refused.
select set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'role','authenticated','aal','aal2')::text,true)
  from wholesale_fixture;
select throws_ok($$select pg_temp.create_invoice((select request_key from wholesale_fixture))$$,'42501',null,
  'a user without the permission cannot issue');
select throws_ok($$select public.list_wholesale_kit_invoices()$$,'42501',null,'nor list the invoices');

select set_config('request.jwt.claims',jsonb_build_object('sub',accountant,'role','authenticated','aal','aal2')::text,true)
  from wholesale_fixture;
-- The owner-approved MG02 no-credit rule for this sheet.
insert into private.representative_resale_fiscal_rule_versions
  (id,rule_key,version,issuer_reference,product_fingerprint,origin_state,destination_state,person_type,
    icms_status,final_consumer,purpose,valid_from,valid_until,fiscal_parameters)
select rule_version,gen_random_uuid(),1,'synthetic issuer',public.read_representative_kit_grade_fingerprint(kit,'standard'),
  'MG','MG','business','taxpayer',false,'resale',now()-interval '1 day',now()+interval '1 day',
  '{"buyerProfile":"MG02","issuerDocument":"12345678000195","classification":"third_party_no_st","creditEligible":false,
    "blingRule":{"scenario":"resale_in_state_no_credit","issuer_state":"MG","series":3,"document_model":55,"cfop":"5102",
    "csosn":"102","icms_rate":0,"pis_cst":"49","cofins_cst":"49","ipi_cst":"99","ipi_cenq":"999",
    "pis_rate":0,"cofins_rate":0,"ipi_rate":0,"natures":[{"final_consumer":false,"external_nature_id":123}]}}'
from wholesale_fixture;
insert into private.representative_resale_fiscal_rule_approvals(rule_version_id,approver_reference,evidence_reference)
select rule_version,'synthetic approver','synthetic evidence' from wholesale_fixture;

select throws_ok($$select pg_temp.create_invoice(gen_random_uuid(),2,36001,pg_temp.buyer('11222333000182'))$$,'22023','wholesale_buyer_cnpj_invalid',
  'an invalid CNPJ is refused');
select throws_ok($$select pg_temp.create_invoice(gen_random_uuid(),2,36001,pg_temp.buyer('11222333000181','SP'))$$,'23514','wholesale_buyer_outside_mg',
  'a buyer outside MG is refused');
select throws_ok($$select pg_temp.create_invoice(gen_random_uuid(),6)$$,'23514','kit_grade_out_of_stock',
  'more sheets than the kit holds is refused');
select throws_ok($$select public.create_wholesale_kit_invoice(gen_random_uuid(),(select kit from wholesale_fixture),'lower_restock',1,35001,'pix',pg_temp.buyer())$$,
  '23514','kit_grade_out_of_stock','a sold-out sheet cannot be invoiced');
select is(pg_temp.standard_stock(),5,'refused sales never take stock');

update wholesale_fixture set invoice=(pg_temp.create_invoice(request_key,2)->>'id')::uuid;
select is(pg_temp.standard_stock(),3,'creating the sale takes the sheets from the kit stock');
select is((pg_temp.create_invoice((select request_key from wholesale_fixture),2)->>'id')::uuid,(select invoice from wholesale_fixture),
  'the same key returns the same record');
select is(pg_temp.standard_stock(),3,'repeating the key never takes stock twice');
select throws_ok($$select pg_temp.create_invoice((select request_key from wholesale_fixture),3)$$,'23505','wholesale_idempotency_conflict',
  'the same key with other values is refused');
select is((select count(*)::integer from jsonb_array_elements(public.list_wholesale_kit_invoices())),1,'the accountant lists the invoice');
select is((select i->>'totalInCents' from jsonb_array_elements(public.list_wholesale_kit_invoices()) i),'72002',
  'the total is quantity times the edited unit price');
select ok((select count(*)=0 from public.audit_logs a join wholesale_fixture f on a.entity_id=f.invoice
  where a.new_data_sanitized::text like '%11222333000181%' or a.new_data_sanitized::text like '%Loja Teste%'),
  'the audit trail carries no buyer data');

-- Worker side: one sale and one invoice only; nothing is authorized without a valid key.
select set_config('request.jwt.claims',jsonb_build_object('role','service_role')::text,true);
select is((public.begin_wholesale_kit_invoice_issue((select invoice from wholesale_fixture))->>'status'),'issuing',
  'the worker starts the attempt');
select is(public.begin_wholesale_kit_invoice_issue((select invoice from wholesale_fixture)),null::jsonb,
  'a running attempt blocks a second one');
select is(public.claim_wholesale_kit_invoice_write((select invoice from wholesale_fixture),'bling_invoice_draft'),false,
  'the invoice draft cannot be claimed before the sale');
select is(public.claim_wholesale_kit_invoice_write((select invoice from wholesale_fixture),'bling_sale'),true,'the sale write is claimed once');
select is(public.claim_wholesale_kit_invoice_write((select invoice from wholesale_fixture),'bling_sale'),false,'and never twice');
select is(public.record_wholesale_kit_invoice_sale((select invoice from wholesale_fixture),900),true,'the Bling sale is recorded');
select is(public.record_wholesale_kit_invoice_authorized((select invoice from wholesale_fixture),900,77,repeat('1',44),'123456789012345',repeat('a',64),'55'),false,
  'an invoice cannot be authorized before its draft exists');
select is(public.claim_wholesale_kit_invoice_write((select invoice from wholesale_fixture),'bling_invoice_draft'),true,'the draft write is claimed');
select is(public.record_wholesale_kit_invoice_draft((select invoice from wholesale_fixture),900,77,repeat('b',64)),true,'the draft is recorded');
select is(public.claim_wholesale_kit_invoice_write((select invoice from wholesale_fixture),'bling_invoice_send',repeat('c',64)),false,
  'sending needs the exact recorded draft hash');
select is(public.record_wholesale_kit_invoice_progress((select invoice from wholesale_fixture),'draft','bling_send_disabled'),true,
  'a draft waiting for Bling sending is kept as a draft');
select is((public.read_wholesale_kit_invoice_job((select invoice from wholesale_fixture))->>'invoiceId'),'77','the job exposes the Bling draft');
select is((public.read_wholesale_kit_invoice_job((select invoice from wholesale_fixture))#>>'{fiscalParameters,blingRule,cfop}'),'5102',
  'the fiscal parameters come from the approved rule, not from the accountant');

-- Cancellation before authorization gives the sheets back exactly once.
select set_config('request.jwt.claims',jsonb_build_object('sub',accountant,'role','authenticated','aal','aal2')::text,true)
  from wholesale_fixture;
select is(public.cancel_wholesale_kit_invoice((select invoice from wholesale_fixture))->>'blingResidue','true',
  'cancelling warns that a sale already exists in Bling');
select is(pg_temp.standard_stock(),5,'cancelling returns the sheets');
select is(public.cancel_wholesale_kit_invoice((select invoice from wholesale_fixture))->>'ok','true','cancelling again is harmless');
select is(pg_temp.standard_stock(),5,'the sheets are returned only once');
select is(public.request_wholesale_kit_invoice_retry((select invoice from wholesale_fixture)),false,'a cancelled invoice cannot be retried');

-- An invoice already transmitted cannot be cancelled.
update wholesale_fixture set invoice=(pg_temp.create_invoice(other_key,1)->>'id')::uuid;
select set_config('request.jwt.claims',jsonb_build_object('role','service_role')::text,true);
select public.begin_wholesale_kit_invoice_issue((select invoice from wholesale_fixture));
select public.claim_wholesale_kit_invoice_write((select invoice from wholesale_fixture),'bling_sale');
select public.record_wholesale_kit_invoice_sale((select invoice from wholesale_fixture),901);
select public.claim_wholesale_kit_invoice_write((select invoice from wholesale_fixture),'bling_invoice_draft');
select public.record_wholesale_kit_invoice_draft((select invoice from wholesale_fixture),901,78,repeat('d',64));
select is(public.claim_wholesale_kit_invoice_write((select invoice from wholesale_fixture),'bling_invoice_send',repeat('d',64)),true,
  'the exact draft can be sent once');
select is(public.record_wholesale_kit_invoice_authorized((select invoice from wholesale_fixture),901,78,
  '31' || repeat('0',18) || '55003' || repeat('1',19),'123456789012345',repeat('e',64),'56'),true,'the authorized invoice is recorded');
select is((select status from private.wholesale_kit_invoices where id=(select invoice from wholesale_fixture)),'authorized',
  'the invoice is authorized with the NF-e number');
select set_config('request.jwt.claims',jsonb_build_object('sub',accountant,'role','authenticated','aal','aal2')::text,true)
  from wholesale_fixture;
select is(public.cancel_wholesale_kit_invoice((select invoice from wholesale_fixture))->>'ok','false',
  'an authorized invoice cannot be cancelled');
select is(pg_temp.standard_stock(),4,'the stock of an authorized sale stays out');

select * from finish();
rollback;
