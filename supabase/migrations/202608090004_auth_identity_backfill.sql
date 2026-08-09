-- Repara identidades criadas antes do trigger de sincronizacao sem elevar
-- privilegios: toda conta recuperada recebe apenas o papel customer.

insert into public.profiles(
  id,
  full_name,
  email_snapshot,
  status
)
select
  user_account.id,
  case
    when pg_catalog.char_length(
      pg_catalog.btrim(coalesce(user_account.raw_user_meta_data ->> 'full_name', ''))
    ) between 3 and 120
      then pg_catalog.btrim(user_account.raw_user_meta_data ->> 'full_name')
    else 'Cliente Curtiz'
  end,
  user_account.email,
  'active'::public.user_status
from auth.users user_account
where user_account.email is not null
  and not exists (
    select 1
    from public.profiles profile
    where profile.id = user_account.id
  )
on conflict (id) do nothing;

insert into public.user_roles(user_id, role)
select profile.id, 'customer'::public.app_role
from public.profiles profile
join auth.users user_account on user_account.id = profile.id
where not exists (
  select 1
  from public.user_roles assigned
  where assigned.user_id = profile.id
    and assigned.role = 'customer'::public.app_role
)
on conflict (user_id, role) do nothing;

notify pgrst, 'reload schema';
