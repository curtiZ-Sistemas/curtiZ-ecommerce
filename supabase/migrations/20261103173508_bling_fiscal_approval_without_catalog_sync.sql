-- Approval bookkeeping is local to curti Z; it is not part of the Bling payload.
-- Do not enqueue provider writes when only approval evidence changes.
create or replace function private.enqueue_bling_catalog_media_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare product_ids uuid[]; v_id uuid;
begin
  if tg_table_schema = 'private' and tg_table_name = 'bling_catalog_metadata' and tg_op = 'UPDATE' then
    if (to_jsonb(old) - array['fiscal_unit_approved', 'evidence_reference', 'updated_at'])
      = (to_jsonb(new) - array['fiscal_unit_approved', 'evidence_reference', 'updated_at']) then
      return null;
    end if;
  end if;
  product_ids := case when tg_op='INSERT' then array[new.product_id]
    when tg_op='DELETE' then array[old.product_id] else array[old.product_id,new.product_id] end;
  for v_id in select link.variant_id from private.bling_product_links link
    join public.product_variants v on v.id=link.variant_id where v.product_id=any(product_ids) loop
    update private.bling_product_links set sync_status='pending',updated_at=now() where variant_id=v_id;
    insert into public.background_jobs(queue,job_type,payload_sanitized,idempotency_key)
    values('bling','bling.product.sync',jsonb_build_object('variantId',v_id),
      'bling:media:' || v_id::text || ':' || extract(epoch from clock_timestamp())::text) on conflict(idempotency_key) do nothing;
  end loop;
  return null;
end;
$$;
