-- Alinha o inventário de cookies e armazenamentos ao comportamento real da loja.

alter table public.cookie_definitions
  add column if not exists storage_type text not null default 'cookie'
  check (storage_type in ('cookie', 'local_storage', 'session_storage'));

insert into public.cookie_categories(id, label, description, required, active, sort_order)
values
  ('preferences', 'Preferências', 'Memoriza escolhas de conveniência solicitadas pelo visitante.', false, true, 2)
on conflict (id) do update set
  label = excluded.label,
  description = excluded.description,
  required = excluded.required,
  active = excluded.active,
  sort_order = excluded.sort_order;

update public.cookie_definitions
set category_id = 'preferences'
where category_id = 'functional';

update public.cookie_categories
set active = false
where id = 'functional';

update public.cookie_categories
set
  label = 'Analytics',
  description = 'Medição consentida do uso e melhoria das recomendações do Intelligence Engine.',
  active = true,
  sort_order = 3
where id = 'analytics';

update public.cookie_categories
set active = false, sort_order = 4
where id = 'marketing';

update public.cookie_definitions
set active = false
where name_pattern = 'curtiz-referral-attribution';

insert into public.cookie_definitions(
  name_pattern,
  category_id,
  provider,
  purpose,
  duration_description,
  first_party,
  storage_type,
  active,
  last_verified_at
)
values
  ('sb-*-auth-token*', 'essential', 'Supabase Auth', 'Manter e renovar a sessão autenticada com segurança.', 'Sessão ou até 12 meses quando o acesso persistente é escolhido.', true, 'cookie', true, now()),
  ('curtiz-auth-persistence', 'essential', 'curti Z', 'Aplicar a duração de sessão escolhida no login.', 'Sessão ou até 12 meses.', true, 'cookie', true, now()),
  ('curtiz-demo-session', 'essential', 'curti Z', 'Manter uma sessão autenticada no ambiente de demonstração.', 'Até o encerramento ou a expiração da sessão.', true, 'cookie', true, now()),
  ('curtiz-cookie-preferences', 'essential', 'curti Z', 'Aplicar no servidor as categorias autorizadas pelo visitante.', 'Até 12 meses ou até uma nova escolha.', true, 'cookie', true, now()),
  ('curtiz-cookie-consent', 'essential', 'curti Z', 'Manter no navegador a versão e as escolhas do consentimento.', 'Até 12 meses ou até uma nova escolha.', true, 'local_storage', true, now()),
  ('curtiz-cart* / curtiz-session-cart*', 'essential', 'curti Z', 'Preservar itens e seleção do carrinho solicitados pelo visitante.', 'Sessão ou armazenamento persistente, conforme a escolha de acesso.', true, 'local_storage', true, now()),
  ('curtiz-favorites', 'essential', 'curti Z', 'Manter a lista de favoritos criada pelo visitante.', 'Até a remoção dos favoritos ou limpeza do navegador.', true, 'local_storage', true, now()),
  ('curtiz-help-* / curtiz:representative-sidebar', 'essential', 'curti Z', 'Manter temporariamente o contexto solicitado de ajuda ou do portal.', 'Durante a sessão atual.', true, 'session_storage', true, now()),
  ('curtiz-recent-searches', 'preferences', 'curti Z', 'Exibir novamente pesquisas recentes feitas neste navegador.', 'Até a remoção pelo visitante ou limpeza do navegador.', true, 'local_storage', true, now()),
  ('curtiz_referral', 'preferences', 'curti Z', 'Preservar uma indicação iniciada pelo próprio visitante.', 'Até 30 dias ou até a retirada do consentimento.', true, 'cookie', true, now()),
  ('curtiz:intelligence-session', 'analytics', 'curti Z Intelligence Engine', 'Agrupar eventos comportamentais consentidos sem identificar diretamente o visitante.', 'Durante a sessão atual.', true, 'session_storage', true, now()),
  ('curtiz:intelligence-recent', 'analytics', 'curti Z Intelligence Engine', 'Manter produtos vistos para recomendações consentidas.', 'Até a retirada do consentimento ou limpeza do navegador.', true, 'local_storage', true, now())
on conflict (name_pattern, provider) do update set
  category_id = excluded.category_id,
  purpose = excluded.purpose,
  duration_description = excluded.duration_description,
  first_party = excluded.first_party,
  storage_type = excluded.storage_type,
  active = excluded.active,
  last_verified_at = excluded.last_verified_at;

update public.cookie_consents
set categories =
  (categories - 'functional') ||
  pg_catalog.jsonb_build_object(
    'preferences',
    categories -> 'preferences' = 'true'::jsonb
      or categories -> 'functional' = 'true'::jsonb
  )
where categories ? 'functional';

notify pgrst, 'reload schema';
