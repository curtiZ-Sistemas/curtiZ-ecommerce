-- Preserve eligibility, idempotency and privileges; fix the invalid PL/pgSQL variable qualifier.
create or replace function private.enqueue_transactional_email(p_order_id uuid,p_kind text)
returns void language plpgsql security definer set search_path='' as $$
declare message_id uuid; v_job_id uuid; due timestamptz;
begin
  if not exists(select 1 from private.transactional_email_runtime where enabled)
    or not private.transactional_email_eligible(p_order_id,p_kind) then return; end if;
  due:=now()+case when p_kind='review_requested' then interval '24 hours' else interval '0' end;
  insert into private.transactional_emails(order_id,kind,due_at) values(p_order_id,p_kind,due)
    on conflict(order_id,kind) do nothing returning id into message_id;
  if message_id is null then return; end if;
  insert into public.background_jobs(queue,job_type,payload_sanitized,idempotency_key,available_at)
    values('transactional_email','resend.'||p_kind,jsonb_build_object('messageId',message_id),
      'resend:'||p_kind||':'||p_order_id::text,due) returning id into v_job_id;
  update private.transactional_emails set job_id=v_job_id where id=message_id;
end;
$$;
