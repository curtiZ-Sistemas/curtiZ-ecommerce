-- Public media/size-guide RLS checks need only these product columns.
-- Keep the table-wide SELECT revoked by catalog_public_column_hardening.
grant select (id, status) on table public.products to anon;
grant select (id, product_id, variant_id, media_type, storage_path, thumbnail_path, alt_text, mime_type, sort_order)
  on table public.product_media to anon, authenticated;

-- Anonymous catalog reads must not execute private authorization functions.
drop policy if exists "public reads active product size guides" on public.product_size_guide_entries;
create policy "public reads active product size guides" on public.product_size_guide_entries
  for select to anon, authenticated using (
    exists (
      select 1 from public.products product
      where product.id = product_size_guide_entries.product_id and product.status = 'active'
    )
  );

drop policy if exists "product readers read size guides" on public.product_size_guide_entries;
create policy "product readers read size guides" on public.product_size_guide_entries
  for select to authenticated using (private.has_permission('products.read'));
