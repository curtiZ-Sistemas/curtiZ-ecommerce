-- Origem idempotente para importações de catálogo. O produto continua sendo salvo
-- pelo RPC transacional existente; esta tabela apenas impede duplicações do mesmo item externo.
create table if not exists public.product_import_sources (
  source text not null check (source ~ '^[a-z0-9_-]{2,40}$'),
  external_key text not null check (char_length(external_key) between 1 and 160),
  product_id uuid not null unique references public.products(id) on delete cascade,
  batch_hash text not null check (batch_hash ~ '^[a-f0-9]{64}$'),
  imported_by uuid not null references public.profiles(id),
  imported_at timestamptz not null default now(),
  primary key (source, external_key)
);

alter table public.product_import_sources enable row level security;
alter table public.product_import_sources force row level security;

drop policy if exists "product import sources read" on public.product_import_sources;
create policy "product import sources read"
  on public.product_import_sources for select to authenticated
  using (private.has_permission('products.create'));

drop policy if exists "product import sources insert" on public.product_import_sources;
create policy "product import sources insert"
  on public.product_import_sources for insert to authenticated
  with check (
    imported_by = auth.uid()
    and private.has_permission('products.create')
    and private.has_permission('products.update')
  );

revoke all on table public.product_import_sources from public, anon;
grant select, insert on table public.product_import_sources to authenticated;

create or replace function public.admin_import_product_authorized(
  p_source text,
  p_external_key text,
  p_batch_hash text,
  p_payload jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, private
as $$
declare
  existing_product_id uuid;
  saved_product_id uuid;
  import_payload jsonb;
begin
  perform private.require_permission('products.create');
  perform private.require_permission('products.update');
  if p_source !~ '^[a-z0-9_-]{2,40}$'
     or char_length(p_external_key) not between 1 and 160
     or p_batch_hash !~ '^[a-f0-9]{64}$'
     or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'invalid product import payload' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_source || chr(0) || p_external_key, 0));
  select product_id into existing_product_id
  from public.product_import_sources
  where source = p_source and external_key = p_external_key;
  if existing_product_id is not null then
    return jsonb_build_object('productId', existing_product_id, 'alreadyImported', true);
  end if;

  import_payload := jsonb_set(p_payload - 'productId', '{status}', '"draft"'::jsonb, true);
  saved_product_id := public.admin_save_product_authorized(import_payload);
  insert into public.product_import_sources(source, external_key, product_id, batch_hash, imported_by)
  values(p_source, p_external_key, saved_product_id, p_batch_hash, auth.uid());

  return jsonb_build_object('productId', saved_product_id, 'alreadyImported', false);
end;
$$;

revoke all on function public.admin_import_product_authorized(text, text, text, jsonb) from public, anon;
grant execute on function public.admin_import_product_authorized(text, text, text, jsonb) to authenticated;

notify pgrst, 'reload schema';
