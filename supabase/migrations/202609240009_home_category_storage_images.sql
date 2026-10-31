create or replace function public.get_home_categories()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', category.id,
    'name', category.name,
    'slug', category.slug,
    'imagePath', media.storage_path
  ) order by category.home_sort_order, category.name), '[]'::jsonb)
  from public.categories category
  join lateral (
    select image.storage_path
    from public.product_categories link
    join public.products product
      on product.id = link.product_id
      and product.status = 'active'
    join public.product_images image
      on image.product_id = product.id
      and image.width > 0
      and image.height > 0
      and image.storage_path !~ '(^/|icon[.]svg$)'
    join storage.objects stored_image
      on stored_image.bucket_id = 'catalog-public'
      and stored_image.name = image.storage_path
      and lower(coalesce(stored_image.metadata ->> 'mimetype', ''))
        in ('image/avif', 'image/jpeg', 'image/png', 'image/webp')
      and (stored_image.metadata ->> 'size') ~ '^[1-9][0-9]*$'
    where link.category_id = category.id
    order by
      image.is_primary desc,
      product.featured desc,
      product.created_at desc,
      image.sort_order,
      image.id
    limit 1
  ) media on true
  where category.active and category.show_on_home;
$$;

revoke all on function public.get_home_categories() from public;
grant execute on function public.get_home_categories() to anon, authenticated;
