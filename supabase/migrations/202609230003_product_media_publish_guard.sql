-- A publication cannot expose branding or an unfinished import job as commercial media.
create or replace function private.require_real_product_image_for_publication()
returns trigger language plpgsql security definer set search_path = '' as $$
declare needs_check boolean := false;
begin
  if new.status = 'active' then
    if tg_op = 'INSERT' then needs_check := true;
    else needs_check := old.status is distinct from new.status;
    end if;
  end if;
  if needs_check and not exists (
    select 1 from public.product_images image
    where image.product_id = new.id
      and nullif(trim(image.storage_path), '') is not null
      and image.storage_path !~ '(^/|icon[.]svg$)'
      and image.width > 0 and image.height > 0
  ) then
    raise exception 'active product requires a real completed image' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists products_require_real_image_insert on public.products;
create trigger products_require_real_image_insert
  before insert on public.products for each row
  execute function private.require_real_product_image_for_publication();

drop trigger if exists products_require_real_image_status on public.products;
create trigger products_require_real_image_status
  before update of status on public.products for each row
  execute function private.require_real_product_image_for_publication();

revoke all on function private.require_real_product_image_for_publication() from public, anon, authenticated;
