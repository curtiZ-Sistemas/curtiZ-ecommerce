insert into public.permissions(code, description)
values ('promotion_bar.manage', 'Gerenciar a barra promocional da loja')
on conflict (code) do update set description = excluded.description;

insert into public.role_permissions(role, permission_id)
select role_name, permission.id
from (values ('admin'::public.app_role), ('manager'::public.app_role)) roles(role_name)
cross join public.permissions permission
where permission.code = 'promotion_bar.manage'
on conflict do nothing;

create table public.store_campaign_messages (
  id uuid primary key default gen_random_uuid(),
  placement text not null default 'top_bar' check (placement = 'top_bar'),
  message_text text not null check (
    char_length(trim(message_text)) between 4 and 140
    and message_text !~ '[<>]'
  ),
  cta_label text check (
    cta_label is null
    or (char_length(trim(cta_label)) between 1 and 40 and cta_label !~ '[<>]')
  ),
  link_path text check (
    link_path is null
    or (
      char_length(link_path) between 1 and 500
      and left(link_path, 1) = '/'
      and left(link_path, 2) <> '//'
      and position(E'\\' in link_path) = 0
      and link_path !~ '[<>"[:cntrl:]]'
    )
  ),
  active boolean not null default false,
  sort_order integer not null default 0 check (sort_order between 0 and 999),
  starts_at timestamptz,
  ends_at timestamptz,
  created_by uuid not null default auth.uid() references public.profiles(id),
  updated_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (cta_label is null or link_path is not null),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);

create index store_campaign_messages_active_order_idx
  on public.store_campaign_messages(placement, sort_order, id)
  where active;

create or replace function private.enforce_store_campaign_message_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.active then
    perform pg_catalog.pg_advisory_xact_lock(2846723001);
    if (
      select count(*)
      from public.store_campaign_messages message
      where message.placement = new.placement
        and message.active
        and message.id <> new.id
    ) >= 3 then
      raise exception 'promotion bar active message limit exceeded' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create or replace function private.protect_store_campaign_message_metadata()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id <> old.id
    or new.placement <> old.placement
    or new.created_by <> old.created_by
    or new.created_at <> old.created_at then
    raise exception 'store campaign message metadata is immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger enforce_store_campaign_message_limit
before insert or update of active, placement on public.store_campaign_messages
for each row execute function private.enforce_store_campaign_message_limit();

create trigger protect_store_campaign_message_metadata
before update on public.store_campaign_messages
for each row execute function private.protect_store_campaign_message_metadata();

create trigger touch_store_campaign_messages
before update on public.store_campaign_messages
for each row execute function private.touch_updated_at();

create or replace function public.reorder_store_campaign_messages(p_message_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('promotion_bar.manage');
  if coalesce(pg_catalog.array_length(p_message_ids, 1), 0) < 1
    or pg_catalog.array_length(p_message_ids, 1) > 100
    or exists (
      select item.id from pg_catalog.unnest(p_message_ids) as item(id)
      group by item.id having count(*) > 1
    ) then
    raise exception 'invalid promotion bar order';
  end if;
  if exists (
    select 1 from pg_catalog.unnest(p_message_ids) as item(id)
    where not exists (
      select 1 from public.store_campaign_messages message
      where message.id = item.id and message.placement = 'top_bar'
    )
  ) then
    raise exception 'promotion bar message not found' using errcode = 'P0002';
  end if;

  update public.store_campaign_messages message
  set sort_order = ordered.position - 1,
      updated_by = auth.uid()
  from pg_catalog.unnest(p_message_ids) with ordinality ordered(id, position)
  where message.id = ordered.id;
end;
$$;

alter table public.store_campaign_messages enable row level security;
alter table public.store_campaign_messages force row level security;

create policy "promotion bar managers read"
on public.store_campaign_messages for select to authenticated
using (private.has_permission('promotion_bar.manage'));

create policy "promotion bar managers insert"
on public.store_campaign_messages for insert to authenticated
with check (
  private.has_permission('promotion_bar.manage')
  and created_by = auth.uid()
  and updated_by = auth.uid()
);

create policy "promotion bar managers update"
on public.store_campaign_messages for update to authenticated
using (private.has_permission('promotion_bar.manage'))
with check (
  private.has_permission('promotion_bar.manage')
  and updated_by = auth.uid()
);

create or replace view public.current_store_promotion_messages
with (security_barrier = true, security_invoker = false)
as
select
  message.id,
  message.message_text,
  message.cta_label,
  message.link_path,
  message.sort_order,
  message.starts_at,
  message.ends_at
from public.store_campaign_messages message
where message.placement = 'top_bar'
  and message.active
  and (message.starts_at is null or message.starts_at <= now())
  and (message.ends_at is null or message.ends_at > now())
order by message.sort_order, message.id
limit 3;

revoke all on public.store_campaign_messages from public, anon, authenticated;
grant select, insert, update on public.store_campaign_messages to authenticated;
revoke all on public.current_store_promotion_messages from public;
grant select on public.current_store_promotion_messages to anon, authenticated;
revoke all on function private.enforce_store_campaign_message_limit() from public, anon, authenticated;
revoke all on function private.protect_store_campaign_message_metadata() from public, anon, authenticated;
revoke all on function public.reorder_store_campaign_messages(uuid[]) from public, anon;
grant execute on function public.reorder_store_campaign_messages(uuid[]) to authenticated;
