CREATE OR REPLACE FUNCTION public.create_support_conversation(p_category text, p_subject text, p_initial_message text, p_related_order_code text DEFAULT NULL::text, p_client_request_id uuid DEFAULT gen_random_uuid())
 RETURNS public.support_conversations
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  existing_conversation public.support_conversations;
  new_conversation public.support_conversations;
  selected_category public.support_categories;
  selected_order_id uuid;
  category_slug text;
begin
  if auth.uid() is null or not private.is_active_user() or private.customer_account_is_closed() then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if char_length(trim(p_subject)) not between 5 and 120
     or char_length(trim(p_initial_message)) not between 10 and 4000 then
    raise exception 'invalid support content' using errcode = '22023';
  end if;

  select c.* into existing_conversation
  from public.support_conversations c
  where c.customer_id = auth.uid() and c.client_request_id = p_client_request_id;
  if found then return existing_conversation; end if;

  category_slug := case p_category
    when 'order' then 'pedido'
    when 'payment' then 'pagamento'
    when 'delivery' then 'entrega'
    when 'return' then 'troca-devolucao'
    when 'product' then 'produto'
    when 'account' then 'conta'
    when 'technical' then 'problema-tecnico'
    else 'outro'
  end;

  select c.* into selected_category
  from public.support_categories c
  where c.slug = category_slug and c.active = true;
  if not found then raise exception 'support category unavailable'; end if;

  if nullif(trim(coalesce(p_related_order_code, '')), '') is not null then
    select o.id into selected_order_id
    from public.orders o
    where o.public_code = trim(p_related_order_code) and o.customer_id = auth.uid();
    if not found then raise exception 'order not found' using errcode = '22023'; end if;
  end if;

  insert into public.support_conversations(
    customer_id, related_order_id, category_id, priority, origin, subject, client_request_id
  ) values (
    auth.uid(), selected_order_id, selected_category.id, selected_category.default_priority,
    'store', trim(p_subject), p_client_request_id
  ) returning * into new_conversation;

  insert into public.support_participants(conversation_id, user_id, participant_role)
  values (new_conversation.id, auth.uid(), 'customer');

  insert into public.support_messages(
    conversation_id, sender_id, sender_role, content_sanitized, is_internal_note
  ) values (
    new_conversation.id, auth.uid(), 'customer', trim(p_initial_message), false
  );

  insert into public.support_status_history(
    conversation_id, previous_status, new_status, reason, changed_by
  ) values (
    new_conversation.id, null, 'queued', 'Chamado criado pelo cliente', auth.uid()
  );

  insert into public.notifications(user_id, type, title, body)
  select distinct ur.user_id, 'support_new', 'Novo atendimento na fila', new_conversation.public_code
  from public.user_roles ur
  join public.profiles p on p.id = ur.user_id and p.status = 'active'
  where ur.role = 'admin';

  return new_conversation;
end;
$function$
