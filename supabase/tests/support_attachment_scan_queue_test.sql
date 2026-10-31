begin;
select plan(8);
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
values ('fa000000-0000-4000-8000-000000000001','scan-queue@example.invalid','{}','{"full_name":"Scan Queue"}');
insert into public.support_conversations(id,customer_id,category_id,priority,origin,subject)
values ('fb000000-0000-4000-8000-000000000001','fa000000-0000-4000-8000-000000000001','41000000-0000-0000-0000-000000000001','normal','account','Scan queue fixture');
insert into public.support_messages(id,conversation_id,sender_id,sender_role,content_sanitized,is_internal_note)
values ('fc000000-0000-4000-8000-000000000001','fb000000-0000-4000-8000-000000000001','fa000000-0000-4000-8000-000000000001','customer','Fixture',false);
insert into public.support_attachments(id,message_id,storage_path,original_name_sanitized,mime_type,size_bytes,scan_status,scan_sha256)
values ('fd000000-0000-4000-8000-000000000001','fc000000-0000-4000-8000-000000000001','fa000000-0000-4000-8000-000000000001/support/fixture.pdf','fixture.pdf','application/pdf',100,'pending',repeat('a',64));
select is((select state from private.support_attachment_scan_jobs where attachment_id='fd000000-0000-4000-8000-000000000001'),
  'queued','A pending upload is enqueued without exposing the file');
update private.support_attachment_scan_jobs set updated_at='1970-01-01' where attachment_id='fd000000-0000-4000-8000-000000000001';
create temporary table claimed_scan as select public.claim_support_attachment_scan() as job;
select is((select job->>'attachmentId' from claimed_scan),'fd000000-0000-4000-8000-000000000001','Worker claims the queued object');
select is(public.finish_support_attachment_scan((select (job->>'jobId')::uuid from claimed_scan),gen_random_uuid(),'clean',repeat('a',64)),
  false,'A different lease cannot finalize the job');
select is(public.finish_support_attachment_scan((select (job->>'jobId')::uuid from claimed_scan),(select (job->>'leaseToken')::uuid from claimed_scan),'unknown',repeat('a',64)),
  false,'Ambiguous verdict cannot release a file');
select is(public.finish_support_attachment_scan((select (job->>'jobId')::uuid from claimed_scan),(select (job->>'leaseToken')::uuid from claimed_scan),'clean',repeat('b',64)),
  true,'Mismatching object is recorded as a failed scan');
select is((select scan_status from public.support_attachments where id='fd000000-0000-4000-8000-000000000001'),'failed',
  'Object mismatch never becomes clean');
select is(has_function_privilege('authenticated','public.finish_support_attachment_scan(uuid,uuid,text,text)','execute'),false,
  'Browser clients cannot set scanner verdicts');
select is(has_function_privilege('anon','public.claim_support_attachment_scan()','execute'),false,
  'Anonymous clients cannot inspect the private scan queue');
select * from finish();
rollback;
