-- Qualify the storage object name: creative_packages also has a name column.
-- Otherwise a package whose label equals its path authorizes unrelated objects.
alter policy "creative audience reads permitted assets" on storage.objects using (
  (bucket_id = 'representative-creatives' and exists (
    select 1 from public.creative_assets a
    where a.storage_path = objects.name and private.can_access_creative(a)
  )) or (bucket_id = 'creative-thumbnails' and exists (
    select 1 from public.creative_assets a
    where a.thumbnail_path = objects.name and private.can_access_creative(a)
  )) or (bucket_id = 'campaign-packages' and exists (
    select 1 from public.creative_packages p
    join public.creative_assets a on a.campaign_id = p.campaign_id
    where p.storage_path = objects.name and private.can_access_creative(a)
  ))
);
