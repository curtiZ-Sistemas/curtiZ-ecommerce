create table if not exists public.product_editor_drafts (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  schema_version integer not null check (schema_version = 1),
  payload jsonb not null check (
    jsonb_typeof(payload) = 'object'
    and octet_length(payload::text) <= 65536
  ),
  saved_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.product_editor_drafts enable row level security;
alter table public.product_editor_drafts force row level security;

drop policy if exists "product draft owner read" on public.product_editor_drafts;
create policy "product draft owner read"
  on public.product_editor_drafts for select to authenticated
  using (
    user_id = auth.uid()
    and private.has_permission('products.create')
    and private.has_permission('products.update')
  );

drop policy if exists "product draft owner insert" on public.product_editor_drafts;
create policy "product draft owner insert"
  on public.product_editor_drafts for insert to authenticated
  with check (
    user_id = auth.uid()
    and private.has_permission('products.create')
    and private.has_permission('products.update')
  );

drop policy if exists "product draft owner update" on public.product_editor_drafts;
create policy "product draft owner update"
  on public.product_editor_drafts for update to authenticated
  using (
    user_id = auth.uid()
    and private.has_permission('products.create')
    and private.has_permission('products.update')
  )
  with check (
    user_id = auth.uid()
    and private.has_permission('products.create')
    and private.has_permission('products.update')
  );

drop policy if exists "product draft owner delete" on public.product_editor_drafts;
create policy "product draft owner delete"
  on public.product_editor_drafts for delete to authenticated
  using (
    user_id = auth.uid()
    and private.has_permission('products.create')
    and private.has_permission('products.update')
  );

drop trigger if exists touch_product_editor_drafts on public.product_editor_drafts;
create trigger touch_product_editor_drafts
  before update on public.product_editor_drafts
  for each row execute function private.touch_updated_at();

revoke all on table public.product_editor_drafts from public, anon;
grant select, insert, update, delete on table public.product_editor_drafts to authenticated;

create or replace function public.save_product_editor_draft(
  p_schema_version integer,
  p_payload jsonb,
  p_saved_at timestamptz
) returns timestamptz
language plpgsql
security invoker
set search_path = pg_catalog, public, private
as $$
declare
  actor uuid := auth.uid();
  effective_saved_at timestamptz;
begin
  if actor is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  perform private.require_permission('products.create');
  perform private.require_permission('products.update');
  if p_schema_version <> 1 or jsonb_typeof(p_payload) <> 'object'
     or octet_length(p_payload::text) > 65536 then
    raise exception 'invalid_product_draft' using errcode = '22023';
  end if;
  if p_saved_at > now() + interval '5 minutes' then
    raise exception 'invalid_product_draft_timestamp' using errcode = '22023';
  end if;

  insert into public.product_editor_drafts(user_id, schema_version, payload, saved_at)
  values(actor, p_schema_version, p_payload, p_saved_at)
  on conflict(user_id) do update set
    schema_version = excluded.schema_version,
    payload = excluded.payload,
    saved_at = excluded.saved_at,
    updated_at = now()
  where public.product_editor_drafts.saved_at <= excluded.saved_at;

  select saved_at into effective_saved_at
  from public.product_editor_drafts
  where user_id = actor;
  return effective_saved_at;
end;
$$;

revoke all on function public.save_product_editor_draft(integer, jsonb, timestamptz) from public, anon;
grant execute on function public.save_product_editor_draft(integer, jsonb, timestamptz) to authenticated;

create or replace function public.admin_save_product_authorized_and_clear_draft(p_payload jsonb)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog, public, private
as $$
declare
  saved_product_id uuid;
begin
  saved_product_id := public.admin_save_product_authorized(p_payload);
  if nullif(trim(coalesce(p_payload->>'productId', '')), '') is null then
    delete from public.product_editor_drafts where user_id = auth.uid();
  end if;
  return saved_product_id;
end;
$$;

revoke all on function public.admin_save_product_authorized_and_clear_draft(jsonb) from public, anon;
grant execute on function public.admin_save_product_authorized_and_clear_draft(jsonb) to authenticated;
