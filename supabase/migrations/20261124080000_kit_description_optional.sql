-- The kit description became optional in the admin panel: an empty description is stored as ''.
alter table public.kits
  alter column description set default '';
