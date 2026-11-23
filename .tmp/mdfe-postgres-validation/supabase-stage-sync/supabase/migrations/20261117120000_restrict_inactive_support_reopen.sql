create or replace function public.reopen_own_support_conversation(p_conversation_id uuid, p_reason text)
returns public.support_conversations
language plpgsql security definer set search_path = ''
as $$
declare conversation public.support_conversations; previous_status public.support_status;
begin
  if auth.uid() is null or not private.is_active_user() or private.customer_account_is_closed() then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if char_length(trim(p_reason)) not between 5 and 500 then raise exception 'invalid reopen'; end if;
  select * into conversation from public.support_conversations where id=p_conversation_id and customer_id=auth.uid() for update;
  if not found or conversation.status not in ('resolved','closed') then raise exception 'conversation cannot be reopened'; end if;
  previous_status:=conversation.status;
  update public.support_conversations set status='reopened',reopened_at=now(),closed_at=null,updated_at=now()
  where id=p_conversation_id returning * into conversation;
  insert into public.support_status_history(conversation_id,previous_status,new_status,reason,changed_by)
  values(conversation.id,previous_status,'reopened',trim(p_reason),auth.uid());
  if conversation.assigned_user_id is not null then
    insert into public.notifications(user_id,type,title,body)
    values(conversation.assigned_user_id,'support_reopened','Atendimento reaberto',conversation.public_code);
  else
    insert into public.notifications(user_id,type,title,body)
    select distinct role.user_id,'support_reopened','Atendimento reaberto',conversation.public_code
    from public.user_roles role join public.profiles profile on profile.id=role.user_id and profile.status='active'
    where role.role='admin';
  end if;
  return conversation;
end;
$$;
