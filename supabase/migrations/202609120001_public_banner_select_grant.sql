begin;

-- RLS continua limitando a leitura aos banners dentro da janela publicada.
-- Este GRANT concede somente SELECT, sem abrir mutacoes para clientes.
grant select on table public.banners to anon, authenticated;

commit;
