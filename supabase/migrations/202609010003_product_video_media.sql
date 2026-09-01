-- Galeria única e ordenável de imagens e vídeos. Os objetos de vídeo são
-- enviados diretamente ao Storage por URL assinada; o Worker nunca recebe o arquivo.

update storage.buckets
set file_size_limit = 83886080,
    allowed_mime_types = array[
      'image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm'
    ]
where id = 'catalog-public';

insert into public.product_media(
  id, product_id, variant_id, media_type, storage_path, thumbnail_path,
  alt_text, mime_type, size_bytes, sort_order, is_primary, created_at
)
select
  image.id, image.product_id, image.variant_id, 'image', image.storage_path, null,
  image.alt_text,
  case lower(storage.extension(image.storage_path))
    when 'jpg' then 'image/jpeg'
    when 'jpeg' then 'image/jpeg'
    when 'webp' then 'image/webp'
    else 'image/png'
  end,
  1, image.sort_order, image.is_primary, image.created_at
from public.product_images image
on conflict (storage_path) do update set
  variant_id = excluded.variant_id,
  alt_text = excluded.alt_text,
  sort_order = excluded.sort_order,
  is_primary = excluded.is_primary;

alter table public.product_media
  drop constraint if exists product_media_video_poster_check;

alter table public.product_media
  add constraint product_media_video_poster_check check (
    media_type = 'image' or nullif(trim(thumbnail_path), '') is not null
  );

create index if not exists product_media_product_order_idx
  on public.product_media(product_id, sort_order, created_at);

create index if not exists product_media_variant_idx
  on public.product_media(product_id, variant_id, sort_order)
  where variant_id is not null;

create or replace function private.validate_product_media_variant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.variant_id is not null and not exists (
    select 1 from public.product_variants variant
    where variant.id = new.variant_id and variant.product_id = new.product_id
  ) then
    raise exception 'media variant does not belong to product';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_product_media_variant on public.product_media;
create trigger validate_product_media_variant
before insert or update of product_id, variant_id on public.product_media
for each row execute function private.validate_product_media_variant();

notify pgrst, 'reload schema';
