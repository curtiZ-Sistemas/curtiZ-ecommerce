-- Flag técnica para dissuadir a abertura do DevTools na loja. Começa desativada e
-- é alterada pelo painel técnico (Feature flags) com justificativa auditada.
insert into public.feature_flags(key, enabled, metadata) values
  ('security.block_devtools', false, '{"description":"Bloqueia atalhos do DevTools (F12, Ctrl+Shift+I/J/C, Ctrl+U) na loja. Dissuasão apenas; não substitui controles no servidor."}'::jsonb)
on conflict (key) do nothing;

-- A loja pública não lê feature_flags (RLS restrita ao painel técnico); expõe só este booleano.
create or replace function public.is_devtools_block_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select flag.enabled from public.feature_flags flag where flag.key = 'security.block_devtools'), false)
$$;

revoke all on function public.is_devtools_block_enabled() from public;
grant execute on function public.is_devtools_block_enabled() to anon, authenticated;
