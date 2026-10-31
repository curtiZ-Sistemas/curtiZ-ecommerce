begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

insert into auth.users(id,instance_id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('fd230000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','image-queue-recovery@test.local','{}','{}',now(),now());
update public.profiles set status='active' where id='fd230000-0000-4000-8000-000000000001';
insert into public.user_roles(user_id,role) values ('fd230000-0000-4000-8000-000000000001','admin') on conflict do nothing;
insert into public.categories(id,name,slug)
values ('fd230000-0000-4000-8000-000000000002','Fila de teste','fila-teste-recovery');
insert into public.products(id,name,slug,category_id,status,base_price)
values ('fd230000-0000-4000-8000-000000000003','Produto de fila','produto-fila-recovery',
  'fd230000-0000-4000-8000-000000000002','draft',5000);
insert into public.product_variants(id,product_id,sku,color_name,color_hex,color_hex_secondary,size,active)
values ('fd230000-0000-4000-8000-000000000005','fd230000-0000-4000-8000-000000000003',
  'QUEUE-RECOVERY-39','Preto','#000000','#FFFFFF','39',true);
insert into public.inventory(variant_id,available_quantity,reserved_quantity)
values ('fd230000-0000-4000-8000-000000000005',1,0);
insert into public.product_import_sessions(id,user_id,schema_version,batch_hash,payload,expires_at)
values ('fd230000-0000-4000-8000-000000000004','fd230000-0000-4000-8000-000000000001',
  'curtiz_import_v1',repeat('a',64),'{}'::jsonb,now()+interval '1 hour');
insert into public.product_import_runs(id,user_id,products_total)
values ('fd230000-0000-4000-8000-000000000004','fd230000-0000-4000-8000-000000000001',1);
insert into public.product_import_run_products(run_id,product_id)
values ('fd230000-0000-4000-8000-000000000004','fd230000-0000-4000-8000-000000000003');

insert into public.product_import_image_jobs(id,product_id,source_url,normalized_url,storage_path,sort_order,status,attempts,lock_token,updated_at,completed_at)
select ('fd230000-0000-4000-8000-'||pg_catalog.lpad(i::text,12,'0'))::uuid,
  'fd230000-0000-4000-8000-000000000003',
  'https://down-sg.img.susercontent.com/file/recovery-'||i,
  'https://down-sg.img.susercontent.com/file/recovery-'||i,
  'products/imports/fd230000-0000-4000-8000-000000000003/'||pg_catalog.lpad(pg_catalog.to_hex(i),64,'0')||'.webp',
  i-1,
  case when i between 1 and 14 then 'queued'
    when i in (15,16,18) then 'processing' else 'completed' end,
  case when i=16 then 1 when i=18 then 5 else 0 end,
  case when i in (15,16,18) then 'fd230000-0000-4000-8000-000000000099'::uuid else null end,
  case when i between 1 and 14 then now()-interval '1 minute'
    when i in (16,18) then now()-interval '6 minutes' else now() end,
  case when i=17 then now() else null end
from pg_catalog.generate_series(1,18) item(i);
insert into public.product_import_run_image_jobs(run_id,job_id)
select 'fd230000-0000-4000-8000-000000000004',id
from public.product_import_image_jobs where product_id='fd230000-0000-4000-8000-000000000003';

create temporary table queue_recovery_snapshot(data jsonb);
grant select,insert on queue_recovery_snapshot to authenticated;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"fd230000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
insert into queue_recovery_snapshot(data)
select public.get_product_import_status('fd230000-0000-4000-8000-000000000004');

select is(jsonb_array_length((select data->'queueJobs' from queue_recovery_snapshot)),15,
  'Fourteen lost queued jobs and one stale processing job are returned for dispatch');
reset role;
select is((select count(distinct item->>'jobId')::integer from queue_recovery_snapshot
  cross join lateral jsonb_array_elements(data->'queueJobs') as jobs(item)),15,
  'A fourteen-image batch plus recovered job has no duplicate queue ids');
select is((select count(*)::integer from public.product_import_image_jobs
  where product_id='fd230000-0000-4000-8000-000000000003' and status='queued'),15,
  'Queued jobs and safe stale processing recovery remain pending');
select is((select status from public.product_import_image_jobs
  where id='fd230000-0000-4000-8000-000000000015'),'processing',
  'A fresh processing lock is not reclaimed');
select is((select status from public.product_import_image_jobs
  where id='fd230000-0000-4000-8000-000000000016'),'queued',
  'A stale processing job is requeued');
select ok((select lock_token is null from public.product_import_image_jobs
  where id='fd230000-0000-4000-8000-000000000016'),'Stale recovery clears its lock token');
select is((select status from public.product_import_image_jobs
  where id='fd230000-0000-4000-8000-000000000017'),'completed',
  'Completed jobs are never requeued');
select is((select status from public.product_import_image_jobs
  where id='fd230000-0000-4000-8000-000000000018'),'failed',
  'An abandoned job at its retry limit fails instead of looping');
set local role authenticated;
select is(jsonb_array_length(public.get_product_import_status('fd230000-0000-4000-8000-000000000004')->'queueJobs'),0,
  'A fresh second status poll does not resend the same queued batch');
select lives_ok($sql$
  select public.admin_enqueue_product_import_images(
    'fd230000-0000-4000-8000-000000000004','fd230000-0000-4000-8000-000000000003',
    '[{"sourceUrl":"https://down-sg.img.susercontent.com/file/recovery-18",
      "normalizedUrl":"https://down-sg.img.susercontent.com/file/recovery-18",
      "storagePath":"products/imports/fd230000-0000-4000-8000-000000000003/0000000000000000000000000000000000000000000000000000000000000012.webp",
      "sortOrder":17,"isPrimary":false,"applyAllSizes":false},
     {"sourceUrl":"https://down-sg.img.susercontent.com/file/recovery-17",
      "normalizedUrl":"https://down-sg.img.susercontent.com/file/recovery-17",
      "storagePath":"products/imports/fd230000-0000-4000-8000-000000000003/0000000000000000000000000000000000000000000000000000000000000011.webp",
      "sortOrder":16,"isPrimary":false,"applyAllSizes":false}]'::jsonb
  )
$sql$, 'Reimport can retry a failed image without inserting a duplicate job');
reset role;
select is((select status||':'||attempts::text from public.product_import_image_jobs
  where id='fd230000-0000-4000-8000-000000000018'),'queued:0',
  'Manual reimport resets attempts only for the failed retry');
select is((select status from public.product_import_image_jobs
  where id='fd230000-0000-4000-8000-000000000017'),'completed',
  'Manual reimport does not enqueue an already completed image');
select is((select count(*)::integer from public.product_import_image_jobs
  where product_id='fd230000-0000-4000-8000-000000000003'),18,
  'The batch still contains only eighteen unique product/image jobs');

set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select lives_ok($$select public.complete_product_import_image_job(
  'fd230000-0000-4000-8000-000000000015','fd230000-0000-4000-8000-000000000099',800,800,3)$$,
  'The worker completes media for the existing product');
reset role;
update public.products set status='active' where id='fd230000-0000-4000-8000-000000000003';
select is((public.search_catalog(p_query=>'Produto de fila')->>'total')::integer,1,
  'A completed commercial image makes the existing product searchable');
select is((public.search_catalog_page(p_query=>'Produto de fila')->>'total')::integer,1,
  'The lightweight continuation RPC returns the same filtered total');
select is(public.search_catalog_page(p_query=>'Produto de fila')->'products',
  public.search_catalog(p_query=>'Produto de fila')->'products',
  'Continuation preserves the first page product contract and stock/media rules');
select ok(not (public.search_catalog_page(p_query=>'Produto de fila') ? 'facets'),
  'Continuation avoids recalculating first-page facets');
select is((select option->>'secondaryHex' from jsonb_array_elements(
  public.search_catalog(p_query=>'Produto de fila')->'facets'->'colors') option where option->>'value'='Preto'),
  '#FFFFFF','Two-tone color facets come from search_catalog without a global variants query');
select is((select count(*)::integer from public.products where id='fd230000-0000-4000-8000-000000000003'),1,
  'Image completion does not recreate the product');

select * from finish();
rollback;
