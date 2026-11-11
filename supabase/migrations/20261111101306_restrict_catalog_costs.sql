-- Apply only after the panel uses admin_read_catalog_costs.
revoke select on table public.products from authenticated;
revoke select (cost_price) on public.products from public, anon, authenticated;
grant select (
  id, name, slug, short_description, description, category_id, collection_id,
  status, featured, base_price, weight_grams, height_cm, width_cm, length_cm,
  seo_title, seo_description, search_document, created_by, updated_by,
  created_at, updated_at, compare_at_price, model_id, status_reason, published_at,
  published_by, merchant_condition, merchant_gender, merchant_age_group,
  google_product_category, merchant_identifier_exists
) on public.products to authenticated;

revoke select on table public.product_variants from authenticated;
revoke select (cost_override) on public.product_variants from public, anon, authenticated;
grant select (
  id, product_id, sku, color_name, color_hex, size, price_override, active,
  barcode, created_at, updated_at, merchant_mpn, color_hex_secondary, display_title
) on public.product_variants to authenticated;

notify pgrst, 'reload schema';
