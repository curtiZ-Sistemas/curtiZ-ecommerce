-- Permite que cada usuário autenticado leia apenas os próprios papéis.
-- Necessário para validar o redirecionamento e a autorização após login/cadastro.

drop policy if exists "user reads own roles" on public.user_roles;
create policy "user reads own roles" on public.user_roles
  for select
  to authenticated
  using (user_id = (select auth.uid()));
