-- Daily operations workspace. The operational role receives execution permissions
-- only; financial, commercial-rule, level and technical permissions are unchanged.

insert into public.permissions(code, description)
values
  ('operations.dashboard.read', 'Ler indicadores operacionais'),
  ('operations.tasks.read', 'Ler tarefas operacionais'),
  ('operations.tasks.execute', 'Executar tarefas operacionais atribuídas'),
  ('operations.occurrences.read', 'Ler ocorrências operacionais'),
  ('operations.occurrences.create', 'Registrar ocorrências operacionais'),
  ('operations.occurrences.resolve', 'Resolver ocorrências operacionais atribuídas'),
  ('operations.inventory.request_adjustment', 'Solicitar ajuste de estoque'),
  ('operations.reports.read', 'Ler relatórios estritamente operacionais'),
  ('operations.documents.read', 'Ler estado de documentos fiscais operacionais'),
  ('returns.inspect', 'Inspecionar itens recebidos em devolução')
on conflict(code) do nothing;

insert into public.role_permissions(role, permission_id)
select 'operational', id
from public.permissions
where code in (
  'operations.dashboard.read', 'operations.tasks.read', 'operations.tasks.execute',
  'operations.occurrences.read', 'operations.occurrences.create',
  'operations.occurrences.resolve', 'operations.inventory.request_adjustment',
  'operations.reports.read', 'operations.documents.read', 'returns.inspect'
)
on conflict do nothing;

insert into public.role_permissions(role, permission_id)
select role, permission.id
from (values ('admin'::public.app_role), ('manager'::public.app_role)) roles(role)
cross join public.permissions permission
where permission.code like 'operations.%'
on conflict do nothing;

create table public.operational_tasks (
  id uuid primary key default gen_random_uuid(),
  public_code text not null unique default ('OP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))),
  task_type text not null check (task_type in (
    'separation', 'expedition', 'shipping', 'kit_assembly', 'kit_shipping',
    'return_receipt', 'return_inspection', 'inventory_count', 'invoice_followup'
  )),
  order_id uuid references public.orders(id) on delete restrict,
  kit_order_id uuid references public.kit_orders(id) on delete restrict,
  return_id uuid references public.returns(id) on delete restrict,
  priority public.support_priority not null default 'normal',
  status text not null default 'queued' check (status in ('queued','in_progress','blocked','completed','cancelled')),
  assigned_to uuid references public.profiles(id),
  due_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  notes text check (notes is null or char_length(notes) <= 1000),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(order_id, kit_order_id, return_id) = 1),
  check ((status = 'completed') = (completed_at is not null))
);

create unique index operational_open_order_task_idx
  on public.operational_tasks(order_id, task_type)
  where order_id is not null and status not in ('completed','cancelled');
create unique index operational_open_kit_task_idx
  on public.operational_tasks(kit_order_id, task_type)
  where kit_order_id is not null and status not in ('completed','cancelled');
create unique index operational_open_return_task_idx
  on public.operational_tasks(return_id, task_type)
  where return_id is not null and status not in ('completed','cancelled');
create index operational_task_queue_idx
  on public.operational_tasks(status, priority desc, due_at nulls last, created_at);

create table public.operational_task_items (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.operational_tasks(id) on delete cascade,
  order_item_id uuid references public.order_items(id) on delete restrict,
  kit_order_item_id uuid references public.kit_order_items(id) on delete restrict,
  expected_quantity integer not null check (expected_quantity > 0),
  checked_quantity integer check (checked_quantity >= 0),
  divergence_reason text check (
    divergence_reason is null or char_length(trim(divergence_reason)) between 3 and 500
  ),
  checked_by uuid references public.profiles(id),
  checked_at timestamptz,
  check (num_nonnulls(order_item_id, kit_order_item_id) = 1),
  check (
    (checked_quantity is null and checked_at is null and checked_by is null)
    or (checked_quantity is not null and checked_at is not null and checked_by is not null)
  ),
  unique(task_id, order_item_id),
  unique(task_id, kit_order_item_id)
);

create table public.operational_occurrences (
  id uuid primary key default gen_random_uuid(),
  public_code text not null unique default ('OCR-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))),
  category text not null check (category in (
    'divergence', 'damaged_product', 'missing_item', 'shipping', 'invoice',
    'return', 'exchange', 'kit', 'inventory', 'customer_service', 'other'
  )),
  priority public.support_priority not null default 'normal',
  status text not null default 'open' check (status in ('open','in_progress','resolved','rejected')),
  order_id uuid references public.orders(id) on delete restrict,
  kit_order_id uuid references public.kit_orders(id) on delete restrict,
  return_id uuid references public.returns(id) on delete restrict,
  representative_id uuid references public.representatives(id) on delete restrict,
  support_conversation_id uuid references public.support_conversations(id) on delete restrict,
  title text not null check (char_length(trim(title)) between 5 and 120),
  description text not null check (char_length(trim(description)) between 5 and 2000),
  resolution text check (resolution is null or char_length(trim(resolution)) between 3 and 2000),
  assigned_to uuid references public.profiles(id),
  opened_by uuid not null references public.profiles(id),
  resolved_by uuid references public.profiles(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status in ('resolved','rejected')) = (resolved_at is not null))
);

create index operational_occurrence_queue_idx
  on public.operational_occurrences(status, priority desc, created_at);

create table public.operational_occurrence_attachments (
  id uuid primary key default gen_random_uuid(),
  occurrence_id uuid not null references public.operational_occurrences(id) on delete cascade,
  storage_path text not null unique,
  original_name_sanitized text not null,
  mime_type text not null check (mime_type in ('image/jpeg','image/png','image/webp','application/pdf')),
  size_bytes integer not null check (size_bytes between 1 and 10485760),
  uploaded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.operational_inventory_adjustment_requests (
  id uuid primary key default gen_random_uuid(),
  public_code text not null unique default ('AJE-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))),
  variant_id uuid not null references public.product_variants(id) on delete restrict,
  quantity_delta integer not null check (quantity_delta <> 0),
  reason text not null check (char_length(trim(reason)) between 5 and 1000),
  status text not null default 'pending' check (status in ('pending','approved','rejected','applied','cancelled')),
  requested_by uuid not null references public.profiles(id),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  applied_movement_id uuid references public.inventory_movements(id),
  created_at timestamptz not null default now()
);

alter table public.operational_tasks enable row level security;
alter table public.operational_tasks force row level security;
alter table public.operational_task_items enable row level security;
alter table public.operational_task_items force row level security;
alter table public.operational_occurrences enable row level security;
alter table public.operational_occurrences force row level security;
alter table public.operational_occurrence_attachments enable row level security;
alter table public.operational_occurrence_attachments force row level security;
alter table public.operational_inventory_adjustment_requests enable row level security;
alter table public.operational_inventory_adjustment_requests force row level security;

create policy "operations read tasks" on public.operational_tasks
for select to authenticated using (private.has_permission('operations.tasks.read'));
create policy "operations read task items" on public.operational_task_items
for select to authenticated using (
  exists (
    select 1 from public.operational_tasks task
    where task.id = task_id and private.has_permission('operations.tasks.read')
  )
);
create policy "operations read occurrences" on public.operational_occurrences
for select to authenticated using (private.has_permission('operations.occurrences.read'));
create policy "operations create occurrences" on public.operational_occurrences
for insert to authenticated with check (
  opened_by = auth.uid() and private.has_permission('operations.occurrences.create')
);
create policy "operations read occurrence attachments" on public.operational_occurrence_attachments
for select to authenticated using (
  exists (
    select 1 from public.operational_occurrences occurrence
    where occurrence.id = occurrence_id
      and private.has_permission('operations.occurrences.read')
  )
);
create policy "operations create occurrence attachments" on public.operational_occurrence_attachments
for insert to authenticated with check (
  uploaded_by = auth.uid()
  and private.has_permission('operations.occurrences.create')
);
create policy "operations read adjustment requests" on public.operational_inventory_adjustment_requests
for select to authenticated using (
  requested_by = auth.uid() or private.has_permission('inventory.approve_adjustment')
);
create policy "operations create adjustment requests" on public.operational_inventory_adjustment_requests
for insert to authenticated with check (
  requested_by = auth.uid()
  and private.has_permission('operations.inventory.request_adjustment')
);

create policy "operations read order items" on public.order_items
for select to authenticated using (
  exists (
    select 1 from public.orders order_record
    where order_record.id = order_id
      and (
        private.has_permission('orders.read_all')
        or private.has_permission('orders.read_assigned')
      )
  )
);
create policy "operations read order history" on public.order_status_history
for select to authenticated using (
  exists (
    select 1 from public.orders order_record
    where order_record.id = order_id
      and (
        private.has_permission('orders.read_all')
        or private.has_permission('orders.read_assigned')
      )
  )
);
create policy "operations read shipments" on public.shipments
for select to authenticated using (
  private.has_permission('orders.read_all')
  or private.has_permission('orders.read_assigned')
);
create policy "operations read tracking" on public.tracking_events
for select to authenticated using (
  exists (
    select 1 from public.shipments shipment
    where shipment.id = shipment_id
      and (
        private.has_permission('orders.read_all')
        or private.has_permission('orders.read_assigned')
      )
  )
);
create policy "operations read inventory movements" on public.inventory_movements
for select to authenticated using (private.has_permission('inventory.read'));
create policy "operations read return records" on public.returns
for select to authenticated using (private.has_permission('returns.read'));
create policy "operations read invoices" on public.erp_documents
for select to authenticated using (private.has_permission('operations.documents.read'));

create or replace function public.start_order_separation(p_order_id uuid)
returns public.operational_tasks
language plpgsql
security definer
set search_path = ''
as $$
declare order_row public.orders%rowtype;
declare task_row public.operational_tasks%rowtype;
begin
  perform private.require_permission('operations.tasks.execute');
  select * into order_row from public.orders where id = p_order_id for update;
  if order_row.id is null then raise exception 'order not found' using errcode = 'P0002'; end if;
  if order_row.payment_status <> 'approved'
    or order_row.status not in ('payment_approved','processing','picking') then
    raise exception 'order is not eligible for separation' using errcode = '23514';
  end if;

  select * into task_row from public.operational_tasks
  where order_id = order_row.id and task_type = 'separation'
    and status not in ('completed','cancelled')
  for update;
  if task_row.id is null then
    insert into public.operational_tasks(
      task_type, order_id, priority, status, assigned_to, started_at
    ) values (
      'separation', order_row.id,
      case when order_row.risk_level = 'high' then 'high'::public.support_priority
        else 'normal'::public.support_priority end,
      'in_progress', auth.uid(), now()
    ) returning * into task_row;
    insert into public.operational_task_items(task_id, order_item_id, expected_quantity)
    select task_row.id, item.id, item.quantity
    from public.order_items item where item.order_id = order_row.id;
  elsif task_row.assigned_to is null then
    update public.operational_tasks
    set assigned_to = auth.uid(), status = 'in_progress',
        started_at = coalesce(started_at, now()), version = version + 1, updated_at = now()
    where id = task_row.id returning * into task_row;
  elsif task_row.assigned_to <> auth.uid() then
    raise exception 'task assigned to another operator' using errcode = '42501';
  end if;
  if order_row.status <> 'picking' then
    update public.orders set status = 'picking', updated_at = now() where id = order_row.id;
    insert into public.order_status_history(order_id, previous_status, new_status, reason, changed_by)
    values(order_row.id, order_row.status, 'picking', 'Separação iniciada', auth.uid());
  end if;
  return task_row;
end;
$$;

create or replace function public.claim_operational_task(p_task_id uuid)
returns public.operational_tasks
language plpgsql
security definer
set search_path = ''
as $$
declare task_row public.operational_tasks%rowtype;
begin
  perform private.require_permission('operations.tasks.execute');
  update public.operational_tasks
  set assigned_to = auth.uid(), status = 'in_progress',
      started_at = coalesce(started_at, now()), version = version + 1, updated_at = now()
  where id = p_task_id and status in ('queued','in_progress')
    and (assigned_to is null or assigned_to = auth.uid())
  returning * into task_row;
  if task_row.id is null then
    raise exception 'task unavailable' using errcode = '42501';
  end if;
  return task_row;
end;
$$;

create or replace function public.start_order_dispatch(
  p_order_id uuid,
  p_task_type text
)
returns public.operational_tasks
language plpgsql
security definer
set search_path = ''
as $$
declare order_row public.orders%rowtype;
declare task_row public.operational_tasks%rowtype;
begin
  perform private.require_permission('operations.tasks.execute');
  if p_task_type not in ('expedition','shipping') then
    raise exception 'invalid dispatch task' using errcode = '22023';
  end if;
  select * into order_row from public.orders where id = p_order_id for update;
  if order_row.id is null or order_row.status <> 'ready_to_ship'
    or order_row.payment_status <> 'approved' then
    raise exception 'order is not ready to ship' using errcode = '23514';
  end if;
  insert into public.operational_tasks(
    task_type, order_id, priority, status, assigned_to, started_at
  ) values (
    p_task_type, order_row.id, 'normal', 'in_progress', auth.uid(), now()
  )
  on conflict (order_id, task_type) where order_id is not null and status not in ('completed','cancelled')
  do update set
    assigned_to = coalesce(public.operational_tasks.assigned_to, auth.uid()),
    status = 'in_progress',
    started_at = coalesce(public.operational_tasks.started_at, now()),
    version = public.operational_tasks.version + 1,
    updated_at = now()
  returning * into task_row;
  if task_row.assigned_to <> auth.uid() then
    raise exception 'task assigned to another operator' using errcode = '42501';
  end if;
  insert into public.operational_task_items(task_id, order_item_id, expected_quantity)
  select task_row.id, item.id, item.quantity
  from public.order_items item where item.order_id = order_row.id
  on conflict (task_id, order_item_id) do nothing;
  return task_row;
end;
$$;

create or replace function public.start_kit_assembly(p_kit_order_id uuid)
returns public.operational_tasks
language plpgsql
security definer
set search_path = ''
as $$
declare kit_row public.kit_orders%rowtype;
declare task_row public.operational_tasks%rowtype;
begin
  perform private.require_permission('representatives.kits.fulfill');
  perform private.require_permission('operations.tasks.execute');
  select * into kit_row from public.kit_orders
  where id = p_kit_order_id and status in ('paid','separating')
  for update;
  if kit_row.id is null then raise exception 'kit order unavailable' using errcode = '23514'; end if;
  insert into public.operational_tasks(
    task_type, kit_order_id, priority, status, assigned_to, started_at
  ) values ('kit_assembly', kit_row.id, 'normal', 'in_progress', auth.uid(), now())
  on conflict (kit_order_id, task_type) where kit_order_id is not null and status not in ('completed','cancelled')
  do update set
    assigned_to = coalesce(public.operational_tasks.assigned_to, auth.uid()),
    status = 'in_progress',
    started_at = coalesce(public.operational_tasks.started_at, now()),
    version = public.operational_tasks.version + 1,
    updated_at = now()
  returning * into task_row;
  if task_row.assigned_to <> auth.uid() then
    raise exception 'task assigned to another operator' using errcode = '42501';
  end if;
  insert into public.operational_task_items(task_id, kit_order_item_id, expected_quantity)
  select task_row.id, item.id, item.quantity
  from public.kit_order_items item where item.kit_order_id = kit_row.id
  on conflict (task_id, kit_order_item_id) do nothing;
  update public.kit_orders set status = 'separating', updated_at = now()
  where id = kit_row.id and status = 'paid';
  return task_row;
end;
$$;

create or replace function public.check_operational_task_item(
  p_task_item_id uuid,
  p_checked_quantity integer,
  p_divergence_reason text default null
)
returns public.operational_task_items
language plpgsql
security definer
set search_path = ''
as $$
declare item_row public.operational_task_items%rowtype;
begin
  perform private.require_permission('operations.tasks.execute');
  if p_checked_quantity < 0 or p_checked_quantity > 999 then
    raise exception 'invalid checked quantity' using errcode = '22023';
  end if;
  select item.* into item_row
  from public.operational_task_items item
  join public.operational_tasks task on task.id = item.task_id
  where item.id = p_task_item_id
    and task.assigned_to = auth.uid() and task.status = 'in_progress'
  for update of item;
  if item_row.id is null then raise exception 'task item unavailable' using errcode = '42501'; end if;
  if p_checked_quantity <> item_row.expected_quantity
    and char_length(trim(coalesce(p_divergence_reason, ''))) < 3 then
    raise exception 'divergence reason required' using errcode = '22023';
  end if;
  update public.operational_task_items
  set checked_quantity = p_checked_quantity,
      divergence_reason = case when p_checked_quantity = expected_quantity then null
        else trim(p_divergence_reason) end,
      checked_by = auth.uid(), checked_at = now()
  where id = item_row.id returning * into item_row;
  return item_row;
end;
$$;

create or replace function public.complete_operational_task(
  p_task_id uuid,
  p_notes text default null
)
returns public.operational_tasks
language plpgsql
security definer
set search_path = ''
as $$
declare task_row public.operational_tasks%rowtype;
declare order_row public.orders%rowtype;
begin
  perform private.require_permission('operations.tasks.execute');
  select * into task_row from public.operational_tasks
  where id = p_task_id and assigned_to = auth.uid() and status = 'in_progress'
  for update;
  if task_row.id is null then raise exception 'task unavailable' using errcode = '42501'; end if;
  if exists (
    select 1 from public.operational_task_items
    where task_id = task_row.id and checked_quantity is null
  ) then
    raise exception 'all task items must be checked' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.operational_task_items
    where task_id = task_row.id and checked_quantity <> expected_quantity
  ) then
    update public.operational_tasks
    set status = 'blocked', notes = nullif(trim(p_notes), ''),
        version = version + 1, updated_at = now()
    where id = task_row.id returning * into task_row;
    return task_row;
  end if;

  update public.operational_tasks
  set status = 'completed', completed_at = now(), notes = nullif(trim(p_notes), ''),
      version = version + 1, updated_at = now()
  where id = task_row.id returning * into task_row;

  if task_row.order_id is not null and task_row.task_type = 'separation' then
    select * into order_row from public.orders where id = task_row.order_id for update;
    update public.orders set status = 'ready_to_ship', updated_at = now() where id = order_row.id;
    insert into public.order_status_history(order_id, previous_status, new_status, reason, changed_by)
    values(order_row.id, order_row.status, 'ready_to_ship', 'Separação conferida', auth.uid());
  end if;
  if task_row.order_id is not null and task_row.task_type = 'expedition' then
    insert into public.operational_tasks(task_type, order_id, priority, status)
    values ('shipping', task_row.order_id, task_row.priority, 'queued')
    on conflict (order_id, task_type) where order_id is not null and status not in ('completed','cancelled')
    do nothing;
  end if;
  if task_row.order_id is not null and task_row.task_type = 'shipping' then
    select * into order_row from public.orders where id = task_row.order_id for update;
    if not exists (
      select 1 from public.shipments shipment
      where shipment.order_id = order_row.id
        and shipment.status in ('label_created','ready','dispatched')
    ) then
      raise exception 'shipment label is not ready' using errcode = '23514';
    end if;
    update public.shipments
    set status = 'dispatched', dispatched_at = coalesce(dispatched_at, now())
    where order_id = order_row.id and status in ('label_created','ready');
    update public.orders set status = 'shipped', updated_at = now() where id = order_row.id;
    insert into public.order_status_history(order_id, previous_status, new_status, reason, changed_by)
    values(order_row.id, order_row.status, 'shipped', 'Expedição confirmada', auth.uid());
  end if;
  if task_row.kit_order_id is not null and task_row.task_type = 'kit_assembly' then
    update public.kit_orders set status = 'ready_to_ship', updated_at = now()
    where id = task_row.kit_order_id and status = 'separating';
  end if;
  return task_row;
end;
$$;

create or replace function public.create_operational_occurrence(
  p_category text,
  p_priority public.support_priority,
  p_title text,
  p_description text,
  p_order_id uuid default null,
  p_kit_order_id uuid default null,
  p_return_id uuid default null,
  p_representative_id uuid default null,
  p_support_conversation_id uuid default null
)
returns public.operational_occurrences
language plpgsql
security definer
set search_path = ''
as $$
declare occurrence public.operational_occurrences%rowtype;
begin
  perform private.require_permission('operations.occurrences.create');
  insert into public.operational_occurrences(
    category, priority, title, description, order_id, kit_order_id, return_id,
    representative_id, support_conversation_id, opened_by, assigned_to
  ) values (
    p_category, p_priority, trim(p_title), trim(p_description), p_order_id,
    p_kit_order_id, p_return_id, p_representative_id, p_support_conversation_id,
    auth.uid(), auth.uid()
  ) returning * into occurrence;
  insert into public.audit_logs(
    actor_id, actor_role, action, entity_type, entity_id, new_data_sanitized
  ) values (
    auth.uid(), private.current_app_role(), 'operations.occurrence.created',
    'operational_occurrence', occurrence.id,
    jsonb_build_object('category', occurrence.category, 'priority', occurrence.priority)
  );
  return occurrence;
end;
$$;

create or replace function public.resolve_operational_occurrence(
  p_occurrence_id uuid,
  p_resolution text,
  p_status text default 'resolved'
)
returns public.operational_occurrences
language plpgsql
security definer
set search_path = ''
as $$
declare occurrence public.operational_occurrences%rowtype;
begin
  perform private.require_permission('operations.occurrences.resolve');
  if p_status not in ('resolved','rejected')
    or char_length(trim(coalesce(p_resolution, ''))) < 3 then
    raise exception 'invalid occurrence resolution' using errcode = '22023';
  end if;
  update public.operational_occurrences
  set status = p_status, resolution = trim(p_resolution), resolved_by = auth.uid(),
      resolved_at = now(), updated_at = now()
  where id = p_occurrence_id and status in ('open','in_progress')
    and (assigned_to is null or assigned_to = auth.uid())
  returning * into occurrence;
  if occurrence.id is null then raise exception 'occurrence unavailable' using errcode = '42501'; end if;
  return occurrence;
end;
$$;

create or replace function public.request_operational_inventory_adjustment(
  p_variant_id uuid,
  p_quantity_delta integer,
  p_reason text
)
returns public.operational_inventory_adjustment_requests
language plpgsql
security definer
set search_path = ''
as $$
declare adjustment public.operational_inventory_adjustment_requests%rowtype;
begin
  perform private.require_permission('operations.inventory.request_adjustment');
  insert into public.operational_inventory_adjustment_requests(
    variant_id, quantity_delta, reason, requested_by
  ) values (p_variant_id, p_quantity_delta, trim(p_reason), auth.uid())
  returning * into adjustment;
  return adjustment;
end;
$$;

create or replace function public.inspect_operational_return_item(
  p_return_item_id uuid,
  p_condition text,
  p_destination text,
  p_result text
)
returns public.return_items
language plpgsql
security definer
set search_path = ''
as $$
declare item_row public.return_items%rowtype;
declare return_row public.returns%rowtype;
begin
  perform private.require_permission('returns.inspect');
  if p_destination not in ('sellable','damaged','discard','supplier')
    or char_length(trim(coalesce(p_condition, ''))) < 3
    or char_length(trim(coalesce(p_result, ''))) < 3 then
    raise exception 'invalid inspection' using errcode = '22023';
  end if;
  select item.* into item_row
  from public.return_items item
  join public.returns return_record on return_record.id = item.return_id
  where item.id = p_return_item_id
    and return_record.status in ('received','inspection')
  for update of item;
  if item_row.id is null then raise exception 'return item unavailable' using errcode = '23514'; end if;
  update public.return_items
  set condition = trim(p_condition), restock_destination = p_destination,
      inspection_result = trim(p_result)
  where id = item_row.id returning * into item_row;
  select * into return_row from public.returns where id = item_row.return_id for update;
  if return_row.status = 'received' then
    update public.returns set status = 'inspection' where id = return_row.id;
  end if;
  return item_row;
end;
$$;

create or replace function public.add_operational_order_note(
  p_order_id uuid,
  p_content text
)
returns public.order_notes
language plpgsql
security definer
set search_path = ''
as $$
declare note_row public.order_notes%rowtype;
begin
  perform private.require_permission('orders.update_operational_status');
  if char_length(trim(coalesce(p_content, ''))) not between 3 and 1000 then
    raise exception 'invalid note' using errcode = '22023';
  end if;
  if not exists (select 1 from public.orders where id = p_order_id) then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  insert into public.order_notes(order_id, author_id, content_sanitized)
  values(p_order_id, auth.uid(), trim(p_content))
  returning * into note_row;
  return note_row;
end;
$$;

create trigger touch_operational_tasks before update on public.operational_tasks
for each row execute function private.touch_updated_at();
create trigger touch_operational_occurrences before update on public.operational_occurrences
for each row execute function private.touch_updated_at();

create policy "operations reads occurrence files" on storage.objects
for select to authenticated using (
  bucket_id = 'internal-private'
  and (storage.foldername(name))[1] = 'operations'
  and private.has_permission('operations.occurrences.read')
);
create policy "operations uploads occurrence files" on storage.objects
for insert to authenticated with check (
  bucket_id = 'internal-private'
  and (storage.foldername(name))[1] = 'operations'
  and (storage.foldername(name))[2] = auth.uid()::text
  and lower(storage.extension(name)) in ('jpg','jpeg','png','webp','pdf')
  and private.has_permission('operations.occurrences.create')
);

revoke all on function public.start_order_separation(uuid) from public, anon;
grant execute on function public.start_order_separation(uuid) to authenticated;
revoke all on function public.claim_operational_task(uuid) from public, anon;
grant execute on function public.claim_operational_task(uuid) to authenticated;
revoke all on function public.start_order_dispatch(uuid, text) from public, anon;
grant execute on function public.start_order_dispatch(uuid, text) to authenticated;
revoke all on function public.start_kit_assembly(uuid) from public, anon;
grant execute on function public.start_kit_assembly(uuid) to authenticated;
revoke all on function public.check_operational_task_item(uuid, integer, text) from public, anon;
grant execute on function public.check_operational_task_item(uuid, integer, text) to authenticated;
revoke all on function public.complete_operational_task(uuid, text) from public, anon;
grant execute on function public.complete_operational_task(uuid, text) to authenticated;
revoke all on function public.create_operational_occurrence(text, public.support_priority, text, text, uuid, uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.create_operational_occurrence(text, public.support_priority, text, text, uuid, uuid, uuid, uuid, uuid) to authenticated;
revoke all on function public.resolve_operational_occurrence(uuid, text, text) from public, anon;
grant execute on function public.resolve_operational_occurrence(uuid, text, text) to authenticated;
revoke all on function public.request_operational_inventory_adjustment(uuid, integer, text) from public, anon;
grant execute on function public.request_operational_inventory_adjustment(uuid, integer, text) to authenticated;
revoke all on function public.inspect_operational_return_item(uuid, text, text, text) from public, anon;
grant execute on function public.inspect_operational_return_item(uuid, text, text, text) to authenticated;
revoke all on function public.add_operational_order_note(uuid, text) from public, anon;
grant execute on function public.add_operational_order_note(uuid, text) to authenticated;
