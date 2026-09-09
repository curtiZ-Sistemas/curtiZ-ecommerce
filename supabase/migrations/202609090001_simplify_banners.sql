-- Keep the existing table and desktop destination contract. Backfill mobile before defaults.
begin;
alter table public.banners
  add column destination_type_mobile text,
  add column destination_id_mobile uuid,
  add column destination_url_mobile text;

update public.banners set
  destination_type_mobile = destination_type,
  destination_id_mobile = destination_id,
  destination_url_mobile = destination_url;

alter table public.banners
  alter column title set default 'Destaque curti Z',
  alter column internal_title set default 'Banner curti Z',
  alter column alt_text set default 'Destaque curti Z',
  alter column position set default 'hero',
  alter column destination_type set default 'none',
  alter column destination_url set default '/',
  alter column destination_type_mobile set default 'none',
  alter column destination_type_mobile set not null,
  alter column destination_url_mobile set default '/',
  alter column destination_url_mobile set not null,
  add constraint banners_mobile_destination_type_check check (destination_type_mobile in (
    'none','product','category','collection','institutional_page','guide','campaign',
    'internal_page','predefined_search','external_url'
  )),
  add constraint banners_mobile_destination_url_check check (
    (destination_type_mobile <> 'external_url' and destination_url_mobile like '/%' and destination_url_mobile not like '//%')
    or (destination_type_mobile = 'external_url' and destination_url_mobile like 'https://%')
  );

create or replace function private.validate_banner_destination()
returns trigger language plpgsql security definer set search_path = '' as $$
declare destination record; destination_host text;
begin
  for destination in
    select new.destination_type as kind, new.destination_url as url
    union all select new.destination_type_mobile, new.destination_url_mobile
  loop
    if destination.url ~ '[\\[:cntrl:]]' or destination.url ~* '%5c|%0[ad]' then
      raise exception 'invalid banner destination' using errcode = '23514';
    end if;
    if destination.kind = 'external_url' then
      destination_host := lower(substring(destination.url from '^https://([^/:?#@]+)(?:[/:?#]|$)'));
      if destination_host is null or not exists (
        select 1 from public.system_settings setting,
          jsonb_array_elements_text(setting.value) configured_host
        where setting.key = 'banner_external_hosts' and lower(configured_host) = destination_host
      ) then
        raise exception 'external banner host is not authorized' using errcode = '42501';
      end if;
    end if;
  end loop;
  return new;
end;
$$;
drop trigger validate_banner_destination on public.banners;
create trigger validate_banner_destination
before insert or update of destination_type, destination_url, destination_type_mobile, destination_url_mobile
on public.banners for each row execute function private.validate_banner_destination();

-- Keep public reads limited to the existing publication window. Internal writes require role + permission/MFA.
drop policy "admin manages banners" on public.banners;
create policy "admin manages banners" on public.banners
  for all to authenticated
  using ((private.user_has_role('admin') or private.user_has_role('manager')) and private.has_permission('banners.update'))
  with check ((private.user_has_role('admin') or private.user_has_role('manager')) and private.has_permission('banners.update'));
-- Storage bucket visibility and upload policies are unchanged.
commit;
