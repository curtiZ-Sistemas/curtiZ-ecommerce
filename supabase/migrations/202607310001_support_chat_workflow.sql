alter table public.support_conversations
  add column if not exists client_request_id uuid;

create unique index if not exists support_conversation_request_id_idx
  on public.support_conversations(customer_id, client_request_id)
  where client_request_id is not null;

insert into public.support_sla_policies(
  id, name, priority, first_response_minutes, update_minutes, resolution_minutes
) values (
  '40000000-0000-0000-0000-000000000001', 'Normal', 'normal', 180, 480, 1440
)
on conflict(id) do nothing;

insert into public.permissions(code, description)
values
  ('support.conversations.read', 'Ler conversas autorizadas'),
  ('support.conversations.assign', 'Atribuir conversas'),
  ('support.conversations.reply', 'Responder conversas'),
  ('support.conversations.transfer', 'Transferir conversas'),
  ('support.internal_notes.create', 'Criar notas internas'),
  ('support.close', 'Encerrar conversas'),
  ('support.reopen', 'Reabrir conversas')
on conflict(code) do nothing;

insert into public.support_categories(
  id, name, slug, description, default_priority, default_sla_policy_id
)
select values_to_insert.id, values_to_insert.name, values_to_insert.slug,
       values_to_insert.description, values_to_insert.priority,
       '40000000-0000-0000-0000-000000000001'::uuid
from (values
  ('41000000-0000-0000-0000-000000000004'::uuid, 'Entrega', 'entrega', 'Dúvidas sobre entrega', 'normal'::public.support_priority),
  ('41000000-0000-0000-0000-000000000005'::uuid, 'Troca ou devolução', 'troca-devolucao', 'Trocas e devoluções', 'normal'::public.support_priority),
  ('41000000-0000-0000-0000-000000000006'::uuid, 'Produto', 'produto', 'Dúvidas sobre produtos', 'normal'::public.support_priority),
  ('41000000-0000-0000-0000-000000000007'::uuid, 'Conta', 'conta', 'Acesso e dados da conta', 'normal'::public.support_priority),
  ('41000000-0000-0000-0000-000000000008'::uuid, 'Outro', 'outro', 'Outros assuntos', 'normal'::public.support_priority)
) as values_to_insert(id, name, slug, description, priority)
on conflict(slug) do nothing;

insert into public.role_permissions(role, permission_id)
select 'manager', id
from public.permissions
where code in (
  'support.conversations.assign',
  'support.conversations.transfer',
  'support.internal_notes.create',
  'support.close',
  'support.reopen'
)
on conflict do nothing;

create or replace function private.can_access_support(conversation public.support_conversations)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    conversation.customer_id = auth.uid()
    or (
      private.current_app_role() = 'admin'
      and private.has_permission('support.conversations.read')
    )
    or (
      private.current_app_role() = 'manager'
      and private.has_permission('support.conversations.read')
    )
    or (
      private.current_app_role() = 'operational'
      and conversation.assigned_role = 'operational'
      and conversation.assigned_user_id = auth.uid()
      and private.has_permission('support.conversations.read')
    )
    or (
      private.current_app_role() = 'technical'
      and conversation.assigned_role = 'technical'
      and conversation.assigned_user_id = auth.uid()
      and conversation.status = 'escalated'
      and private.has_permission('support.conversations.read')
    );
$$;

create or replace function private.can_reply_support(conversation public.support_conversations)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (
      conversation.customer_id = auth.uid()
      and conversation.status not in ('closed', 'cancelled', 'spam')
    )
    or (
      private.current_app_role() = 'manager'
      and private.has_permission('support.conversations.reply')
    )
    or (
      conversation.assigned_user_id = auth.uid()
      and private.current_app_role() = conversation.assigned_role
      and private.has_permission('support.conversations.reply')
    );
$$;

drop policy if exists "support messages authorized insert" on public.support_messages;
create policy "support messages authorized insert" on public.support_messages
  for insert to authenticated with check (
    sender_id = auth.uid()
    and private.is_active_user()
    and exists(
      select 1
      from public.support_conversations c
      where c.id = conversation_id
        and private.can_reply_support(c)
        and (
          (c.customer_id = auth.uid() and sender_role = 'customer' and is_internal_note = false)
          or
          (
            c.customer_id <> auth.uid()
            and sender_role = private.current_app_role()
            and private.has_permission('support.conversations.reply')
            and (
              is_internal_note = false
              or private.has_permission('support.internal_notes.create')
            )
          )
        )
    )
  );

create policy "support staff reads assignment history" on public.support_assignments
  for select to authenticated using (
    private.current_app_role() <> 'customer'
    and exists(
      select 1 from public.support_conversations c
      where c.id = conversation_id and private.can_access_support(c)
    )
  );

create policy "support staff reads status history" on public.support_status_history
  for select to authenticated using (
    private.current_app_role() <> 'customer'
    and exists(
      select 1 from public.support_conversations c
      where c.id = conversation_id and private.can_access_support(c)
    )
  );

create or replace function private.handle_support_message_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_conversation public.support_conversations;
begin
  select c.* into current_conversation
  from public.support_conversations c
  where c.id = new.conversation_id
  for update;

  if new.sender_role = 'customer' then
    update public.support_conversations
    set status = case
          when status = 'waiting_customer' then 'in_progress'::public.support_status
          else status
        end,
        updated_at = now()
    where id = new.conversation_id;
  elsif new.is_internal_note = false then
    update public.support_conversations
    set status = 'waiting_customer',
        first_response_at = coalesce(first_response_at, now()),
        updated_at = now()
    where id = new.conversation_id
      and status not in ('resolved', 'closed', 'cancelled', 'spam');
  else
    update public.support_conversations
    set updated_at = now()
    where id = new.conversation_id;
  end if;

  begin
    if new.sender_role = 'customer' then
      if current_conversation.assigned_user_id is not null then
        insert into public.notifications(user_id, type, title, body)
        values (
          current_conversation.assigned_user_id,
          'support_message',
          'Nova mensagem em atendimento',
          current_conversation.public_code
        );
      else
        insert into public.notifications(user_id, type, title, body)
        select distinct ur.user_id, 'support_message', 'Nova mensagem na fila', current_conversation.public_code
        from public.user_roles ur
        join public.profiles p on p.id = ur.user_id and p.status = 'active'
        where ur.role = 'admin';
      end if;
    elsif new.is_internal_note = false then
      insert into public.notifications(user_id, type, title, body)
      values (
        current_conversation.customer_id,
        'support_reply',
        'Seu atendimento recebeu uma resposta',
        current_conversation.public_code
      );
    end if;
  exception when others then
    null;
  end;
  return new;
end;
$$;

drop trigger if exists support_message_created on public.support_messages;
create trigger support_message_created
  after insert on public.support_messages
  for each row execute function private.handle_support_message_created();

alter publication supabase_realtime add table public.support_conversations;

create or replace function public.create_support_conversation(
  p_category text,
  p_subject text,
  p_initial_message text,
  p_related_order_code text default null,
  p_client_request_id uuid default gen_random_uuid()
)
returns public.support_conversations
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_conversation public.support_conversations;
  new_conversation public.support_conversations;
  selected_category public.support_categories;
  selected_order_id uuid;
  category_slug text;
begin
  if auth.uid() is null or not private.is_active_user() then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if private.current_app_role() <> 'customer' then
    raise exception 'customer account required' using errcode = '42501';
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
$$;

create or replace function public.claim_support_conversation(p_conversation_id uuid)
returns public.support_conversations
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_conversation public.support_conversations;
  actor_role public.app_role;
begin
  perform private.require_permission('support.conversations.assign');
  actor_role := private.current_app_role();
  if actor_role not in ('admin', 'manager') then
    raise exception 'role cannot claim support' using errcode = '42501';
  end if;

  select c.* into current_conversation
  from public.support_conversations c
  where c.id = p_conversation_id
  for update;
  if not found then raise exception 'support not found'; end if;
  if current_conversation.assigned_user_id is not null
     or current_conversation.status not in ('open', 'queued', 'reopened') then
    raise exception 'support already assigned' using errcode = '40001';
  end if;

  update public.support_conversations
  set assigned_user_id = auth.uid(), assigned_role = actor_role, status = 'in_progress'
  where id = p_conversation_id
  returning * into current_conversation;

  insert into public.support_assignments(
    conversation_id, assigned_from, assigned_to, assigned_role, reason, assigned_by
  ) values (
    p_conversation_id, null, auth.uid(), actor_role, 'Atendimento assumido pela fila', auth.uid()
  );
  insert into public.support_status_history(
    conversation_id, previous_status, new_status, reason, changed_by
  ) values (
    p_conversation_id, 'queued', 'in_progress', 'Atendimento assumido', auth.uid()
  );
  return current_conversation;
end;
$$;

create or replace function public.transfer_support_conversation(
  p_conversation_id uuid,
  p_target_user_id uuid,
  p_target_role public.app_role,
  p_reason text
)
returns public.support_conversations
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_conversation public.support_conversations;
  previous_assignee uuid;
  previous_status public.support_status;
  next_status public.support_status;
begin
  perform private.require_permission('support.conversations.transfer');
  if p_target_role in ('customer', 'admin') or char_length(trim(p_reason)) < 10 then
    raise exception 'invalid transfer' using errcode = '22023';
  end if;
  if not exists(
    select 1 from public.profiles p
    join public.user_roles ur on ur.user_id = p.id
    where p.id = p_target_user_id and p.status = 'active' and ur.role = p_target_role
  ) then
    raise exception 'target unavailable' using errcode = '22023';
  end if;

  select c.* into current_conversation
  from public.support_conversations c
  where c.id = p_conversation_id
  for update;
  if not found then raise exception 'support not found'; end if;
  if private.current_app_role() <> 'manager'
     and current_conversation.assigned_user_id <> auth.uid() then
    raise exception 'only owner can transfer' using errcode = '42501';
  end if;

  previous_assignee := current_conversation.assigned_user_id;
  previous_status := current_conversation.status;
  next_status := case when p_target_role = 'technical' then 'escalated' else 'in_progress' end;
  update public.support_conversations
  set assigned_user_id = p_target_user_id, assigned_role = p_target_role, status = next_status
  where id = p_conversation_id
  returning * into current_conversation;

  insert into public.support_assignments(
    conversation_id, assigned_from, assigned_to, assigned_role, reason, assigned_by
  ) values (
    p_conversation_id, previous_assignee, p_target_user_id, p_target_role, trim(p_reason), auth.uid()
  );
  insert into public.support_status_history(
    conversation_id, previous_status, new_status, reason, changed_by
  ) values (
    p_conversation_id, previous_status, next_status, 'Atendimento transferido', auth.uid()
  );
  insert into public.notifications(user_id, type, title, body)
  values (p_target_user_id, 'support_transfer', 'Atendimento transferido para você', current_conversation.public_code);
  return current_conversation;
end;
$$;

create or replace function public.set_support_conversation_status(
  p_conversation_id uuid,
  p_status public.support_status,
  p_reason text
)
returns public.support_conversations
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_conversation public.support_conversations;
  previous_status public.support_status;
begin
  if p_status not in ('waiting_customer', 'resolved', 'closed', 'reopened')
     or char_length(trim(p_reason)) < 5 then
    raise exception 'invalid status transition' using errcode = '22023';
  end if;
  if p_status = 'reopened' then
    perform private.require_permission('support.reopen');
  else
    perform private.require_permission('support.close');
  end if;

  select c.* into current_conversation
  from public.support_conversations c
  where c.id = p_conversation_id
  for update;
  if not found then raise exception 'support not found'; end if;
  if private.current_app_role() <> 'manager'
     and current_conversation.assigned_user_id <> auth.uid() then
    raise exception 'only owner can change status' using errcode = '42501';
  end if;
  if current_conversation.status = 'closed' and p_status <> 'reopened' then
    raise exception 'closed support must be reopened first' using errcode = '22023';
  end if;

  previous_status := current_conversation.status;
  update public.support_conversations
  set status = p_status,
      resolved_at = case when p_status = 'resolved' then now() else resolved_at end,
      closed_at = case when p_status = 'closed' then now() else closed_at end,
      reopened_at = case when p_status = 'reopened' then now() else reopened_at end
  where id = p_conversation_id
  returning * into current_conversation;

  insert into public.support_status_history(
    conversation_id, previous_status, new_status, reason, changed_by
  ) values (
    p_conversation_id, previous_status, p_status, trim(p_reason), auth.uid()
  );
  return current_conversation;
end;
$$;

revoke all on function public.create_support_conversation(text, text, text, text, uuid) from public, anon;
revoke all on function public.claim_support_conversation(uuid) from public, anon;
revoke all on function public.transfer_support_conversation(uuid, uuid, public.app_role, text) from public, anon;
revoke all on function public.set_support_conversation_status(uuid, public.support_status, text) from public, anon;

grant execute on function public.create_support_conversation(text, text, text, text, uuid) to authenticated;
grant execute on function public.claim_support_conversation(uuid) to authenticated;
grant execute on function public.transfer_support_conversation(uuid, uuid, public.app_role, text) to authenticated;
grant execute on function public.set_support_conversation_status(uuid, public.support_status, text) to authenticated;

create or replace function public.list_support_transfer_targets()
returns table(user_id uuid, full_name text, role public.app_role)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('support.conversations.transfer');
  return query
    select p.id, p.full_name, ur.role
    from public.profiles p
    join public.user_roles ur on ur.user_id = p.id
    where p.status = 'active'
      and ur.role in ('operational', 'manager', 'technical')
    order by ur.role, p.full_name;
end;
$$;

revoke all on function public.list_support_transfer_targets() from public, anon;
grant execute on function public.list_support_transfer_targets() to authenticated;
