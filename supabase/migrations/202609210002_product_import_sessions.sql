-- Sessões curtas guardam apenas o catálogo já normalizado no preview.
-- O XLSX não precisa ser reenviado nem reinterpretado durante a importação.
create table public.product_import_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  schema_version text not null check (schema_version = 'curtiz_import_v1'),
  batch_hash text not null check (batch_hash ~ '^[a-f0-9]{64}$'),
  payload jsonb not null check (
    jsonb_typeof(payload) = 'object'
    and jsonb_typeof(payload->'batch') = 'object'
    and jsonb_typeof(payload->'batch'->'products') = 'array'
    and jsonb_array_length(payload->'batch'->'products') between 1 and 100
    and octet_length(payload::text) <= 2097152
  ),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '1 hour'),
  check (expires_at > created_at and expires_at <= created_at + interval '2 hours')
);

create index product_import_sessions_expiry_idx
  on public.product_import_sessions(expires_at);

alter table public.product_import_sessions enable row level security;
alter table public.product_import_sessions force row level security;

create policy "product import sessions read own"
  on public.product_import_sessions for select to authenticated
  using (
    user_id = auth.uid()
    and expires_at > now()
    and private.has_permission('products.create')
    and private.has_permission('products.update')
  );

create policy "product import sessions insert own"
  on public.product_import_sessions for insert to authenticated
  with check (
    user_id = auth.uid()
    and private.has_permission('products.create')
    and private.has_permission('products.update')
  );

create policy "product import sessions delete own"
  on public.product_import_sessions for delete to authenticated
  using (
    user_id = auth.uid()
    and private.has_permission('products.create')
    and private.has_permission('products.update')
  );

revoke all on table public.product_import_sessions from public, anon;
grant select, insert, delete on table public.product_import_sessions to authenticated;

notify pgrst, 'reload schema';
