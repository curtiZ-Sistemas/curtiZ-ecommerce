-- No offers, prices, fiscal approvals, recipients or provider jobs are seeded.
alter table public.kit_items add column resale_allocation_weight integer
  check (resale_allocation_weight between 1 and 1000000);

create function public.read_representative_resale_context(p_kit_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('kitId',k.id,'name',k.name,'merchandiseTotalInCents',k.price_in_cents,
    'items',coalesce((select jsonb_agg(jsonb_build_object(
      'variantId',v.id,'sku',v.sku,'description',p.name,'quantity',ki.quantity,
      'active',v.active and p.status='active','available',i.available_quantity,
      'allocationWeight',ki.resale_allocation_weight,
      'metadata',case when m.product_id is null then null else jsonb_build_object(
        'commercial_unit',m.commercial_unit,'pairs_per_sku',m.pairs_per_sku,'ncm',m.ncm,'origin',m.origin,'cest',m.cest) end,
      'composition',coalesce((select jsonb_agg(jsonb_build_object(
        'sku',c.sku,'description',c.description,'unit',c.unit,'quantity_pairs',c.quantity_pairs,
        'allocation_weight',c.allocation_weight,'ncm',c.ncm,'origin',c.origin,'cest',c.cest,
        'source_current',c.source_hash=private.bling_kit_source_hash(v.id)) order by c.position)
        from private.bling_kit_fiscal_components c where c.kit_variant_id=v.id),'[]'::jsonb)
    ) order by v.id) from public.kit_items ki
      join public.product_variants v on v.id=ki.variant_id join public.products p on p.id=v.product_id
      left join public.inventory i on i.variant_id=v.id
      left join private.bling_catalog_metadata m on m.product_id=p.id where ki.kit_id=k.id),'[]'::jsonb))
  from public.kits k where k.id=p_kit_id and k.active and exists (
    select 1 from public.representatives r join public.profiles profile on profile.id=r.user_id
    where r.user_id=auth.uid() and profile.status='active'
      and r.status in('approved_waiting_kit','active','unqualified')
      and (not exists(select 1 from public.kit_level_rules rule where rule.kit_id=k.id)
        or exists(select 1 from public.kit_level_rules rule where rule.kit_id=k.id
          and rule.level_id=r.current_level_id and rule.available))
  );
$$;
revoke all on function public.read_representative_resale_context(uuid) from public,anon,service_role;
grant execute on function public.read_representative_resale_context(uuid) to authenticated;

-- Applies to the legacy RPC, direct Data API inserts and status updates too.
-- This gate has no runtime flag/approval shortcut. Opening resale requires a
-- separate reviewed implementation after legitimate fiscal homologation.
create function private.guard_representative_resale_homologation()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='INSERT' then
    raise exception 'resale_not_homologated' using errcode='23514';
  end if;
  if (new.status is distinct from old.status and new.status not in('cancelled','refunded'))
    or new.paid_at is distinct from old.paid_at
    or new.payment_reference is distinct from old.payment_reference
    or new.shipped_at is distinct from old.shipped_at
    or new.delivered_at is distinct from old.delivered_at then
    raise exception 'resale_not_homologated' using errcode='23514';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_representative_resale_homologation() from public,anon,authenticated,service_role;
create trigger representative_resale_homologation_gate
before insert or update on public.kit_orders
for each row execute function private.guard_representative_resale_homologation();
