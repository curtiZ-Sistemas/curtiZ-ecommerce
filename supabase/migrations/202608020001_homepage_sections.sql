-- Migration: 202608020001_homepage_sections.sql
-- Tabela para o Construtor Dinâmico da Página Inicial

create table if not exists public.homepage_sections (
  id uuid primary key default gen_random_uuid(),
  section_type text not null check (section_type in ('banner_hero', 'featured_products', 'categories_grid', 'banner_promo', 'reviews_carousel', 'brands_strip', 'custom_banner')),
  title text,
  subtitle text,
  settings jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  sort_order integer not null default 0,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);

alter table public.homepage_sections enable row level security;
alter table public.homepage_sections force row level security;

create policy "public reads active homepage sections" on public.homepage_sections
  for select to anon, authenticated using (
    active = true
    and (starts_at is null or starts_at <= now())
    and (ends_at is null or ends_at > now())
  );

create policy "admin and manager manage homepage sections" on public.homepage_sections
  for all to authenticated using (
    private.has_permission('content.manage') or private.has_permission('banners.update')
  )
  with check (
    private.has_permission('content.manage') or private.has_permission('banners.update')
  );

create trigger touch_homepage_sections before update on public.homepage_sections
  for each row execute function private.touch_updated_at();
